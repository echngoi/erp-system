"""
ADMS / iclock Protocol Handler
================================

Ronald Jack AI06F (port 5005) sử dụng giao thức iclock (ADMS push mode).
Máy chấm công tự gửi HTTP request tới server khi:
  - Khởi động (handshake)
  - Có chấm công mới (ATTLOG)
  - Có sự kiện vận hành (OPERLOG)
  - Định kỳ polling lệnh (getrequest)

Endpoints:
  GET  /iclock/cdata?SN=xxx           → Handshake
  POST /iclock/cdata?SN=xxx&table=xxx → Push dữ liệu
  GET  /iclock/getrequest?SN=xxx      → Device xin lệnh
  POST /iclock/devicecmd?SN=xxx       → Device xác nhận lệnh

Cấu hình trên máy chấm công:
  Menu → Comm. → Cloud Server Setting
    Server: http://<DJANGO_IP>
    Port: 8000  (hoặc port Django đang chạy)
"""
import logging
from datetime import datetime

from django.http import HttpResponse
from django.utils import timezone
from django.views import View
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt

from .models import Employee, AttendanceLog, SyncLog
from .zk_service import adms_record_contact

logger = logging.getLogger(__name__)


def _format_ts(dt):
    """Format datetime to VN local time string."""
    return timezone.localtime(dt).strftime('%Y-%m-%d %H:%M:%S') if dt else ''


def _notify_websocket(records_list):
    """Gửi thông báo qua WebSocket khi có chấm công mới."""
    try:
        from channels.layers import get_channel_layer
        from asgiref.sync import async_to_sync
        channel_layer = get_channel_layer()
        if channel_layer:
            async_to_sync(channel_layer.group_send)(
                'attendance_live',
                {
                    'type': 'attendance.push',
                    'data': {
                        'records': records_list,
                        'source': 'iclock_push',
                    },
                }
            )
    except Exception as e:
        logger.debug(f"WebSocket notify skipped: {e}")


@method_decorator(csrf_exempt, name='dispatch')
class IClockCdataView(View):
    """
    /iclock/cdata — endpoint chính của iclock protocol.

    GET  → Handshake: máy gửi SN, server trả cấu hình
    POST → Push data: máy gửi ATTLOG / OPERLOG / USERINFO
    """

    def get(self, request):
        sn = request.GET.get('SN', 'unknown')
        options = request.GET.get('options', '')
        push_ver = request.GET.get('pushver', '')
        logger.info(f"[iclock] Handshake từ SN={sn}, pushver={push_ver}, options={options}")

        # Ghi nhận máy vừa liên lạc
        client_ip = request.META.get('REMOTE_ADDR')
        adms_record_contact(sn, ip=client_ip)

        # Trả về cấu hình cho máy
        # Stamp: mốc thời gian, máy chỉ gửi records mới hơn stamp
        # TransFlag: loại dữ liệu máy cần gửi
        # Realtime=1: máy gửi ngay khi có chấm công (không đợi batch)
        response_lines = [
            f"GET OPTION FROM: {sn}",
            "Stamp=0",
            "OpStamp=0",
            "PhotoStamp=0",
            "ErrorDelay=30",
            "Delay=10",
            "TransTimes=00:00;14:05",
            "TransInterval=1",
            "TransFlag=TransData AttLog\tOpLog\tAttPhoto\tEnrollUser\tEnrollFP",
            "Realtime=1",
            f"TimeZone=7",
            f"ServerVer=2.4.1",
        ]
        body = '\r\n'.join(response_lines) + '\r\n'
        return HttpResponse(body, content_type='text/plain')

    def post(self, request):
        sn = request.GET.get('SN', 'unknown')
        table = request.GET.get('table', '').upper()
        stamp = request.GET.get('Stamp', '')
        body = request.body.decode('utf-8', errors='ignore')
        logger.info(f"[iclock] POST SN={sn}, table={table}, Stamp={stamp}, body_len={len(body)}")

        # Ghi nhận máy vừa liên lạc
        client_ip = request.META.get('REMOTE_ADDR')
        adms_record_contact(sn, ip=client_ip)

        if table == 'ATTLOG':
            count = self._save_attlog(body, sn)
            return HttpResponse(f"OK: {count}", content_type='text/plain')

        elif table == 'OPERLOG':
            logger.info(f"[iclock] OPERLOG: {body[:300]}")
            return HttpResponse("OK", content_type='text/plain')

        elif table == 'ENROLLUSER' or table == 'USERINFO':
            count = self._save_userinfo(body, sn)
            return HttpResponse(f"OK: {count}", content_type='text/plain')

        else:
            # Một số firmware gửi ATTLOG không qua param table
            if '\t' in body and len(body.strip().split('\n')[0].split('\t')) >= 2:
                count = self._save_attlog(body, sn)
                return HttpResponse(f"OK: {count}", content_type='text/plain')
            logger.info(f"[iclock] Unknown table={table}, body={body[:200]}")
            return HttpResponse("OK", content_type='text/plain')

    def _save_attlog(self, body, sn):
        """
        Parse ATTLOG body.

        Format (tab-separated):
          <UserID>\t<DateTime>\t<Verified>\t<Status>\t<WorkCode>\n

        Ví dụ:
          1\t2026-03-28 08:05:33\t1\t0\t0\t0\t0\t0
          2\t2026-03-28 08:10:12\t1\t1\t0\t0\t0\t0
        """
        saved = 0
        errors = 0
        new_records = []

        for line in body.strip().split('\n'):
            line = line.strip('\r\n\t ')
            if not line:
                continue

            parts = line.split('\t')
            if len(parts) < 2:
                continue

            try:
                user_id = parts[0].strip()
                ts_str = parts[1].strip().replace('/', '-')

                # Validated: phải là chuỗi ngày giờ hợp lệ
                ts = datetime.strptime(ts_str, '%Y-%m-%d %H:%M:%S')
                ts = timezone.make_aware(ts)

                # parts[2] = verified method (FP/face/card)
                # parts[3] = status (0=check-in, 1=check-out, etc.)
                status_val = int(parts[3]) if len(parts) > 3 else 0
                # Một số firmware: parts[2] là status, parts[3] là punch
                # Ronald Jack AI06F: thường dùng parts[3] cho status
                punch = status_val  # map status → punch type

                employee = Employee.objects.filter(user_id=user_id).first()
                _, created = AttendanceLog.objects.get_or_create(
                    user_id=user_id,
                    timestamp=ts,
                    defaults={
                        'employee': employee,
                        'status': int(parts[2]) if len(parts) > 2 else 0,
                        'punch': punch,
                    }
                )
                if created:
                    saved += 1
                    record_data = {
                        'user_id': user_id,
                        'employee_name': employee.name if employee else user_id,
                        'timestamp': _format_ts(ts),
                        'punch': punch,
                    }
                    new_records.append(record_data)
                    logger.info(f"[iclock] Saved: user={user_id} ts={ts}")

            except Exception as e:
                errors += 1
                logger.warning(f"[iclock] Parse error '{line}': {e}")

        # Ghi SyncLog
        if saved > 0:
            SyncLog.objects.create(
                status='success',
                records_synced=saved,
                finished_at=timezone.now(),
            )
            # Push qua WebSocket
            if new_records:
                _notify_websocket(new_records)

        if errors:
            logger.warning(f"[iclock] ATTLOG: saved={saved}, errors={errors}")

        return saved

    def _save_userinfo(self, body, sn):
        """Parse ENROLLUSER / USERINFO push."""
        saved = 0
        for line in body.strip().split('\n'):
            line = line.strip('\r\n\t ')
            if not line or line.startswith('USERINFO') or line.startswith('ENROLLUSER'):
                continue
            # Format: USER PIN=<id>\tName=<name>\tPri=<pri>\tPasswd=\tCard=\tGrp=<g>\tTZ=...
            data = {}
            for part in line.split('\t'):
                if '=' in part:
                    k, v = part.split('=', 1)
                    data[k.strip()] = v.strip()

            pin = data.get('PIN', '').strip()
            if not pin:
                continue
            try:
                Employee.objects.update_or_create(
                    user_id=pin,
                    defaults={
                        'uid': int(pin) if pin.isdigit() else 0,
                        'name': data.get('Name', f'User {pin}'),
                        'privilege': int(data.get('Pri', 0)),
                        'group_id': data.get('Grp', ''),
                        'card': int(data.get('Card', 0) or 0),
                    }
                )
                saved += 1
            except Exception as e:
                logger.warning(f"[iclock] USERINFO parse error: {e}")
        return saved


@method_decorator(csrf_exempt, name='dispatch')
class IClockGetRequestView(View):
    """
    /iclock/getrequest — máy polling xin lệnh từ server.

    Trả về "OK" nếu không có lệnh.
    Trả về lệnh (ví dụ CHECK, INFO, REBOOT) nếu có.
    """

    def get(self, request):
        sn = request.GET.get('SN', 'unknown')
        logger.debug(f"[iclock] getrequest SN={sn}")

        # Ghi nhận máy vừa liên lạc
        client_ip = request.META.get('REMOTE_ADDR')
        adms_record_contact(sn, ip=client_ip)

        # Hiện tại không gửi lệnh gì, trả OK
        return HttpResponse("OK", content_type='text/plain')


@method_decorator(csrf_exempt, name='dispatch')
class IClockDeviceCmdView(View):
    """
    /iclock/devicecmd — máy xác nhận đã thực hiện lệnh.
    """

    def post(self, request):
        sn = request.GET.get('SN', 'unknown')
        body = request.body.decode('utf-8', errors='ignore')
        logger.info(f"[iclock] devicecmd SN={sn}: {body[:200]}")
        return HttpResponse("OK", content_type='text/plain')


@method_decorator(csrf_exempt, name='dispatch')
class CatchAllDeviceView(View):
    """
    Catch-all cho /iclock/<bất kỳ> — log requests lạ để debug kết nối máy.
    """

    def dispatch(self, request, *args, **kwargs):
        subpath = kwargs.get('subpath', '')
        sn = request.GET.get('SN', 'unknown')
        client_ip = request.META.get('REMOTE_ADDR')
        body = ''
        if request.method == 'POST':
            body = request.body.decode('utf-8', errors='ignore')[:300]

        logger.warning(
            f"[iclock] CATCH-ALL: {request.method} /iclock/{subpath} "
            f"from={client_ip} SN={sn} params={dict(request.GET)} body={body}"
        )

        # Vẫn ghi nhận contact nếu có SN
        if sn != 'unknown':
            adms_record_contact(sn, ip=client_ip)

        return HttpResponse("OK", content_type='text/plain')
