"""
Management command: test_device

Phát hiện giao thức máy chấm công và test kết nối.

Ronald Jack AI06F port 5005 có thể dùng một trong hai giao thức:
  1. ZKTeco binary (pyzk)  — port 4370 thường
  2. ADMS/HTTP push        — port 5005 thường (máy tự đẩy dữ liệu lên server)

Usage:
    python manage.py test_device
    python manage.py test_device --ip 192.168.1.225 --port 5005
    python manage.py test_device --port 4370        (thử port chuẩn ZKTeco)
"""
import socket
import requests
from django.core.management.base import BaseCommand
from django.conf import settings


class Command(BaseCommand):
    help = 'Phát hiện giao thức và test kết nối máy chấm công'

    def add_arguments(self, parser):
        parser.add_argument('--ip',   default=settings.ZK_DEVICE_IP)
        parser.add_argument('--port', type=int, default=settings.ZK_DEVICE_PORT)

    def handle(self, *args, **options):
        ip   = options['ip']
        port = options['port']

        self.stdout.write(f"\n{'='*55}")
        self.stdout.write(f"  Chẩn đoán máy chấm công: {ip}:{port}")
        self.stdout.write(f"{'='*55}\n")

        # ── Bước 1: Ping TCP cơ bản ────────────────────────────
        self.stdout.write("▶ [1] Kiểm tra cổng TCP mở...")
        tcp_open = self._check_tcp(ip, port)
        if tcp_open:
            self.stdout.write(self.style.SUCCESS(f"  ✓ Cổng {port} đang mở"))
        else:
            self.stdout.write(self.style.ERROR(
                f"  ✗ Cổng {port} không phản hồi. Kiểm tra:\n"
                f"     - Máy chấm công đang bật?\n"
                f"     - Cùng mạng LAN? (ping {ip})\n"
                f"     - Firewall Windows có chặn không?"
            ))
            return

        # ── Bước 2: Phát hiện giao thức ────────────────────────
        self.stdout.write("\n▶ [2] Phát hiện giao thức...")
        proto = self._detect_protocol(ip, port)
        self.stdout.write(f"  Giao thức phát hiện: {proto}")

        # ── Bước 3: Test HTTP/ADMS ──────────────────────────────
        self.stdout.write("\n▶ [3] Thử HTTP / ADMS (Ronald Jack port 5005)...")
        self._test_http(ip, port)

        # ── Bước 4: Thử ZKTeco binary trên port hiện tại ───────
        self.stdout.write("\n▶ [4] Thử ZKTeco binary protocol...")
        self._test_zk_binary(ip, port)

        # ── Bước 5: Thử port 4370 (ZKTeco chuẩn) ──────────────
        if port != 4370:
            self.stdout.write("\n▶ [5] Thử ZKTeco binary trên port 4370 (cổng chuẩn)...")
            if self._check_tcp(ip, 4370):
                self._test_zk_binary(ip, 4370)
            else:
                self.stdout.write("  ℹ Port 4370 không mở (bình thường nếu máy dùng port khác)")

        # ── Kết luận ────────────────────────────────────────────
        self.stdout.write(f"\n{'='*55}")
        self.stdout.write("  KẾT LUẬN:")
        self.stdout.write(f"{'='*55}")
        self.stdout.write(
            "  Ronald Jack AI06F port 5005 thường hoạt động theo chế độ\n"
            "  ADMS — máy TỰ ĐẨY dữ liệu lên server (push mode).\n"
            "  Server cần lắng nghe HTTP tại port 5005, KHÔNG kết nối ra máy.\n\n"
            "  Nếu kết quả bên trên cho thấy HTTP → xem hướng dẫn ADMS trong README.\n"
            "  Nếu ZKTeco binary thành công → dùng pyzk bình thường.\n"
        )

    def _check_tcp(self, ip, port, timeout=5):
        try:
            s = socket.create_connection((ip, port), timeout=timeout)
            s.close()
            return True
        except:
            return False

    def _detect_protocol(self, ip, port):
        """Gửi 8 byte đầu ZKTeco binary và xem máy phản hồi gì."""
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            s.settimeout(5)
            s.connect((ip, port))
            # ZKTeco handshake packet
            s.send(b'\x50\x00\x00\x00\x00\x00\x00\x00')
            data = s.recv(64)
            s.close()
            if data:
                if data[:4] in (b'HTTP', b'GET ', b'POST'):
                    return 'HTTP / ADMS (máy đang hoạt động server mode)'
                elif data[0:1] == b'\x50':
                    return 'ZKTeco binary protocol'
                else:
                    hex_data = data[:16].hex()
                    return f'Unknown ({hex_data}...)'
            return 'Không có phản hồi'
        except ConnectionResetError:
            return 'Máy reset kết nối — có thể ADMS push mode (bình thường)'
        except Exception as e:
            return f'Lỗi: {e}'

    def _test_http(self, ip, port):
        """Thử HTTP GET — ADMS server thường phản hồi."""
        urls = [
            f'http://{ip}:{port}/',
            f'http://{ip}:{port}/iclock/cdata',
            f'http://{ip}:{port}/iclock/getrequest',
        ]
        for url in urls:
            try:
                r = requests.get(url, timeout=4)
                self.stdout.write(self.style.SUCCESS(
                    f"  ✓ HTTP OK: {url}\n"
                    f"    Status: {r.status_code}\n"
                    f"    Body: {r.text[:120]}"
                ))
                return True
            except requests.ConnectionError:
                self.stdout.write(f"  ✗ {url} — Connection refused")
            except requests.Timeout:
                self.stdout.write(f"  ⏱ {url} — Timeout")
            except Exception as e:
                self.stdout.write(f"  ✗ {url} — {e}")
        return False

    def _test_zk_binary(self, ip, port):
        try:
            from zk import ZK
            for force_udp, ommit_ping, desc in [
                (False, True,  'TCP+ommit_ping'),
                (False, False, 'TCP'),
                (True,  True,  'UDP+ommit_ping'),
            ]:
                zk = ZK(ip, port=port, timeout=5, password=0,
                        force_udp=force_udp, ommit_ping=ommit_ping)
                conn = None
                try:
                    conn = zk.connect()
                    users = conn.get_users()
                    att   = conn.get_attendance()
                    self.stdout.write(self.style.SUCCESS(
                        f"  ✓ ZK binary OK [{desc}] — "
                        f"{len(users)} users, {len(att)} records\n"
                        f"  → Cập nhật .env: ZK_FORCE_UDP={'True' if force_udp else 'False'}, "
                        f"ZK_OMMIT_PING={'True' if ommit_ping else 'False'}"
                    ))
                    return True
                except Exception as e:
                    self.stdout.write(f"  ✗ [{desc}]: {e}")
                finally:
                    if conn:
                        try: conn.disconnect()
                        except: pass
        except ImportError:
            self.stdout.write("  ✗ pyzk chưa cài: pip install pyzk")
        return False
