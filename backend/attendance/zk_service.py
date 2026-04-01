"""
ZKTeco / Ronald Jack AI06F — Dual Protocol Service
====================================================

Ronald Jack AI06F port 5005 thường dùng ADMS (HTTP push mode):
  Máy tự đẩy dữ liệu lên server — server không kết nối ra máy.

ZKTeco binary (port 4370): server kết nối ra máy, dùng pyzk.

File này hỗ trợ CẢ HAI, tự phát hiện qua ZK_PROTOCOL trong .env:
  ZK_PROTOCOL=auto    ← tự phát hiện (mặc định)
  ZK_PROTOCOL=adms    ← ép ADMS mode
  ZK_PROTOCOL=binary  ← ép ZKTeco binary (pyzk)
"""
import logging
import socket
from datetime import datetime
from typing import Optional
from django.conf import settings

logger = logging.getLogger(__name__)


# ── ZKTeco Binary Service ──────────────────────────────────────────────────────

class ZKBinaryService:
    def __init__(self):
        self.ip       = settings.ZK_DEVICE_IP
        self.port     = settings.ZK_DEVICE_PORT
        self.timeout  = settings.ZK_DEVICE_TIMEOUT
        self.password = settings.ZK_DEVICE_PASSWORD
        self._profile = None  # cache working profile index

    def _connect(self):
        from zk import ZK
        profiles = [
            (False, True), (False, False), (True, True), (True, False)
        ]
        if self._profile is not None:
            f, o = profiles[self._profile]
            return ZK(self.ip, port=self.port, timeout=self.timeout,
                      password=self.password, force_udp=f, ommit_ping=o).connect()
        last = None
        for i, (f, o) in enumerate(profiles):
            try:
                conn = ZK(self.ip, port=self.port, timeout=self.timeout,
                          password=self.password, force_udp=f, ommit_ping=o).connect()
                self._profile = i
                return conn
            except Exception as e:
                last = e
        raise ConnectionError(f"ZK binary connect failed: {last}")

    def test_connection(self):
        conn = None
        try:
            conn = self._connect()
            return {
                'status': 'connected', 'protocol': 'ZKTeco Binary',
                'ip': self.ip, 'port': self.port,
                'firmware':      _safe(conn.get_firmware_version),
                'serial_number': _safe(conn.get_serialnumber),
                'platform':      _safe(conn.get_platform),
                'device_name':   _safe(conn.get_device_name) or 'Ronald Jack AI06F',
            }
        except Exception as e:
            self._profile = None
            return {'status': 'disconnected', 'protocol': 'ZKTeco Binary',
                    'ip': self.ip, 'port': self.port, 'error': str(e)}
        finally:
            _disc(conn)

    def get_all_attendance(self):
        conn = None
        try:
            conn = self._connect()
            conn.disable_device()
            out = []
            for a in conn.get_attendance():
                out.append({
                    'user_id':    a.user_id,
                    'timestamp':  a.timestamp.strftime('%Y-%m-%d %H:%M:%S') if a.timestamp else None,
                    'status':     a.status,
                    'punch':      a.punch,
                    'punch_type': _punch_label(a.punch),
                })
            conn.enable_device()
            return out
        except Exception:
            self._profile = None
            raise
        finally:
            _edisc(conn)

    def get_users(self):
        conn = None
        try:
            conn = self._connect()
            conn.disable_device()
            out = []
            for u in conn.get_users():
                out.append({
                    'uid': u.uid, 'user_id': u.user_id, 'name': u.name,
                    'privilege': u.privilege,
                    'privilege_label': _priv_label(u.privilege),
                    'group_id': u.group_id, 'card': u.card,
                    'password': '***' if u.password else '',
                })
            conn.enable_device()
            return out
        except Exception:
            self._profile = None
            raise
        finally:
            _edisc(conn)

    def get_device_time(self):
        conn = None
        try:
            conn = self._connect()
            t = conn.get_time()
            return {
                'device_time': t.strftime('%Y-%m-%d %H:%M:%S') if t else None,
                'server_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            }
        finally:
            _disc(conn)

    def set_device_time(self, dt=None):
        conn = None
        try:
            conn = self._connect()
            conn.set_time(dt or datetime.now())
            return True
        finally:
            _disc(conn)

    def clear_attendance(self):
        conn = None
        try:
            conn = self._connect()
            conn.disable_device()
            conn.clear_attendance()
            conn.enable_device()
            return True
        finally:
            _edisc(conn)

    def restart_device(self):
        conn = None
        try:
            conn = self._connect()
            conn.restart()
            return True
        finally:
            pass


# ── ADMS Device Contact Tracking ──────────────────────────────────────────────
# Module-level dict lưu thời điểm cuối máy chấm công gửi request
# Key = serial number, Value = {last_seen, ip, sn}
_adms_device_registry = {}

ADMS_ONLINE_THRESHOLD = 120  # seconds — nếu không liên lạc > 120s → offline


def adms_record_contact(sn, ip=None, devinfo=None):
    """Ghi nhận máy chấm công vừa liên lạc."""
    entry = _adms_device_registry.get(sn, {})
    entry.update({
        'last_seen': datetime.now(),
        'ip': ip,
        'sn': sn,
    })
    if devinfo and isinstance(devinfo, dict):
        entry['devinfo'] = devinfo
    _adms_device_registry[sn] = entry


def adms_get_last_contact():
    """Lấy thông tin liên lạc gần nhất từ bất kỳ máy nào."""
    if not _adms_device_registry:
        return None
    latest = max(_adms_device_registry.values(), key=lambda x: x['last_seen'])
    return latest


# ── ADMS Command Queue ──────────────────────────────────────────────────────────────
# Server → Device commands: enqueue here, WS consumer picks up on next heartbeat
_adms_command_queue = []  # list of {cmd, sn, params, queued_at}


def adms_enqueue_command(cmd, sn=None, **params):
    """Enqueue a command to send to device on next heartbeat."""
    _adms_command_queue.append({
        'cmd': cmd,
        'sn': sn,
        'params': params,
        'queued_at': datetime.now(),
    })
    logger.info(f"[ADMS] Command enqueued: {cmd} for sn={sn}")


def adms_dequeue_commands(sn):
    """Pop all pending commands for a specific device (or all if sn=None)."""
    global _adms_command_queue
    matched = [c for c in _adms_command_queue if c['sn'] is None or c['sn'] == sn]
    _adms_command_queue = [c for c in _adms_command_queue if c not in matched]
    return matched


def adms_get_pending_commands():
    """List all pending commands (read-only, for API)."""
    return list(_adms_command_queue)


# Command results tracking
_adms_command_results = []  # list of {sn, cmd, result, msg, received_at}


def adms_save_command_result(sn, cmd, result, msg):
    _adms_command_results.append({
        'sn': sn, 'cmd': cmd, 'result': result, 'msg': msg,
        'received_at': datetime.now(),
    })
    # Keep only last 50 results
    if len(_adms_command_results) > 50:
        _adms_command_results.pop(0)


def adms_get_command_results():
    return list(_adms_command_results)


# ── ADMS Service (Ronald Jack port 5005 push mode) ────────────────────────────

class ADMSService:
    """
    Máy chấm công tự đẩy (push) dữ liệu về server qua HTTP.
    Dữ liệu nhận tại iclock endpoints.
    Không thể pull từ server lên máy.
    """

    def __init__(self):
        self.ip   = settings.ZK_DEVICE_IP
        self.port = settings.ZK_DEVICE_PORT

    def test_connection(self):
        # Kiểm tra TCP reachable
        try:
            s = socket.create_connection((self.ip, self.port), timeout=4)
            s.close()
            reachable = True
        except Exception:
            reachable = False

        # Kiểm tra máy có liên lạc gần đây không
        contact = adms_get_last_contact()
        if contact:
            elapsed = (datetime.now() - contact['last_seen']).total_seconds()
            is_online = elapsed < ADMS_ONLINE_THRESHOLD
        else:
            is_online = False
            elapsed = None

        devinfo = contact.get('devinfo', {}) if contact else {}

        result = {
            'status': 'connected' if is_online else 'waiting',
            'protocol': 'ADMS Push (WebSocket)',
            'ip': self.ip, 'port': self.port,
            'device_reachable': reachable,
            'device_name': devinfo.get('modelname', 'Ronald Jack AI06F'),
            'serial_number': contact['sn'] if contact else None,
            'device_ip': contact.get('ip') if contact else None,
            'firmware': devinfo.get('firmware'),
            'last_push': contact['last_seen'].strftime('%Y-%m-%d %H:%M:%S') if contact else None,
            'last_push_seconds_ago': int(elapsed) if elapsed is not None else None,
            'note': (
                'Máy đang hoạt động, dữ liệu được đẩy qua ADMS.'
                if is_online else
                'Đang chờ máy chấm công kết nối. '
                'Kiểm tra cấu hình Cloud Server trên máy → IP server = IP máy tính, Port = 8000.'
            ),
        }

        if devinfo:
            result['device_stats'] = {
                'total_users': devinfo.get('useduser', 0),
                'total_faces': devinfo.get('usedface', 0),
                'total_fingerprints': devinfo.get('usedfp', 0),
                'total_logs': devinfo.get('usedlog', 0),
                'new_logs': devinfo.get('usednewlog', 0),
            }

        return result

    def get_all_attendance(self):
        from .models import AttendanceLog
        from django.utils import timezone as tz
        return [
            {
                'user_id':    r.user_id,
                'timestamp':  tz.localtime(r.timestamp).strftime('%Y-%m-%d %H:%M:%S'),
                'status':     r.status,
                'punch':      r.punch,
                'punch_type': _punch_label(r.punch),
            }
            for r in AttendanceLog.objects.all().order_by('-timestamp')[:500]
        ]

    def get_users(self):
        from .models import Employee
        return [
            {
                'uid': e.uid, 'user_id': e.user_id, 'name': e.name,
                'privilege': e.privilege, 'privilege_label': _priv_label(e.privilege),
                'group_id': e.group_id, 'card': e.card, 'password': '',
            }
            for e in Employee.objects.all()
        ]

    def get_device_time(self):
        return {
            'device_time': None,
            'server_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'note': 'ADMS mode — không đọc được giờ máy',
        }

    def set_device_time(self, dt=None):
        raise NotImplementedError("ADMS mode không hỗ trợ set giờ")

    def clear_attendance(self):
        raise NotImplementedError("ADMS mode không hỗ trợ xóa từ server")

    def restart_device(self):
        raise NotImplementedError("ADMS mode không hỗ trợ restart từ server")


# ── Auto-detect ───────────────────────────────────────────────────────────────

def _detect_service():
    protocol = getattr(settings, 'ZK_PROTOCOL', 'auto').lower()
    ip   = getattr(settings, 'ZK_DEVICE_IP',   '192.168.1.225')
    port = getattr(settings, 'ZK_DEVICE_PORT',  5005)

    if protocol == 'adms':
        logger.info("ZK: ADMS mode (từ .env)")
        return ADMSService()
    if protocol == 'binary':
        logger.info("ZK: Binary mode (từ .env)")
        return ZKBinaryService()

    # Auto: thử ZKTeco handshake
    logger.info(f"ZK: Auto-detect tại {ip}:{port}...")
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(4)
        s.connect((ip, port))
        s.send(b'\x50\x00\x00\x00\x00\x00\x00\x00')
        data = s.recv(8)
        s.close()
        if data and data[0:1] == b'\x50':
            logger.info("ZK: Phát hiện ZKTeco binary")
            return ZKBinaryService()
        logger.info("ZK: Phản hồi lạ → ADMS mode")
        return ADMSService()
    except ConnectionResetError:
        logger.info("ZK: Connection reset → ADMS push mode")
        return ADMSService()
    except Exception as e:
        logger.warning(f"ZK: Auto-detect lỗi ({e}) → ADMS mode mặc định")
        return ADMSService()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _safe(fn):
    try: return fn()
    except: return 'N/A'

def _disc(conn):
    if conn:
        try: conn.disconnect()
        except: pass

def _edisc(conn):
    if conn:
        try: conn.enable_device()
        except: pass
        try: conn.disconnect()
        except: pass

def _punch_label(p):
    return {0:'Vào ca',1:'Ra ca',2:'Nghỉ giải lao',
            3:'Trở lại',4:'Tăng ca vào',5:'Tăng ca ra'}.get(p, f'Loại {p}')

def _priv_label(p):
    return {0:'Nhân viên',14:'Quản trị viên',1:'Người dùng'}.get(p,'Không xác định')


# Singleton
zk_service = _detect_service()
