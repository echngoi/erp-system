"""
WebSocket consumer cho Ronald Jack ADMS push protocol.

Máy chấm công Ronald Jack AI06F kết nối qua WebSocket tại /pub/chat
để push dữ liệu chấm công, user info, v.v.

Giao thức:
  1. Máy kết nối WebSocket → /pub/chat
  2. Máy gửi text message chứa dữ liệu (thường JSON hoặc tab-separated)
  3. Server parse và lưu vào DB
"""
import json
import logging
from datetime import datetime
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.utils import timezone

logger = logging.getLogger('attendance.adms_ws')


def _format_ts(dt):
    """Format datetime to VN local time string."""
    return timezone.localtime(dt).strftime('%Y-%m-%d %H:%M:%S') if dt else ''


class ADMSDeviceConsumer(AsyncWebsocketConsumer):
    """
    WebSocket handler cho /pub/chat — nhận kết nối từ máy chấm công.
    """

    async def connect(self):
        self.device_ip = self.scope['client'][0]
        self.device_sn = 'unknown'
        self.total_logs_received = 0  # Track cumulative logindex per session
        logger.warning(f"[ADMS-WS] Device connecting from {self.device_ip}")

        # Log headers để debug
        headers = dict(self.scope.get('headers', []))
        for k, v in headers.items():
            logger.info(f"[ADMS-WS] Header: {k.decode('utf-8', errors='replace')}={v.decode('utf-8', errors='replace')}")

        await self.accept()

        # Ghi nhận kết nối
        await self._record_contact()

        logger.warning(f"[ADMS-WS] Device {self.device_ip} connected via WebSocket /pub/chat")

    async def disconnect(self, close_code):
        logger.warning(f"[ADMS-WS] Device {self.device_ip} disconnected (code={close_code})")

    async def receive(self, text_data=None, bytes_data=None):
        """Nhận message từ máy chấm công."""
        data = text_data or (bytes_data.decode('utf-8', errors='replace') if bytes_data else '')
        logger.warning(f"[ADMS-WS] Received from {self.device_ip}: {data[:500]}")

        await self._record_contact()

        # Thử parse dạng JSON
        if data.strip().startswith('{'):
            try:
                msg = json.loads(data)
                await self._handle_json_message(msg)
                return
            except json.JSONDecodeError:
                pass

        # Thử parse dạng text protocol (key=value hoặc tab-separated)
        await self._handle_text_message(data)

    async def _handle_json_message(self, msg):
        """Xử lý message dạng JSON từ máy."""
        msg_type = msg.get('cmd') or msg.get('type') or msg.get('action') or ''
        logger.warning(f"[ADMS-WS] JSON message type={msg_type}: {json.dumps(msg, ensure_ascii=False)[:500]}")

        # Một số firmware gửi dạng:
        # {"cmd":"reg", "sn":"xxx"} — đăng ký
        # {"cmd":"sendlog", "sn":"xxx", "record":"1\t2026-03-28 08:00:00\t1\t0"} — chấm công
        # {"cmd":"senduser", "sn":"xxx", "record":"..."} — user info

        if msg_type in ('reg', 'register', 'init'):
            self.device_sn = msg.get('sn', msg.get('SN', 'unknown'))
            devinfo = msg.get('devinfo', {})
            await self._record_contact(devinfo=devinfo)

            new_log_count = int(devinfo.get('usednewlog', 0) or 0)
            used_log = int(devinfo.get('usedlog', 0) or 0)

            # AiFace firmware expects: result=true (boolean), minimal fields
            # nosendlog=false = please send logs
            # logcount = how many logs server already has → device skips those
            reg_resp = {
                'ret': 'reg',
                'result': True,
                'cloudtime': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            }
            if new_log_count > 0 and self.total_logs_received == 0:
                # First connect in this session — request all logs
                reg_resp['nosendlog'] = False
                reg_resp['logcount'] = 0
            elif new_log_count > 0 and self.total_logs_received > 0:
                # Reconnect after we already received logs — tell device we have them
                reg_resp['nosendlog'] = False
                reg_resp['logcount'] = used_log
            else:
                reg_resp['nosendlog'] = True

            resp_text = json.dumps(reg_resp)
            logger.warning(f"[ADMS-WS] REG response → {resp_text}")
            await self.send(text_data=resp_text)

            if new_log_count > 0:
                logger.warning(f"[ADMS-WS] Device {self.device_sn} has {new_log_count} unsent logs, waiting for sendlog...")

            # Check pending commands
            await self._dispatch_pending_commands()

        elif msg_type in ('sendlog', 'attlog', 'ATTLOG'):
            record = msg.get('record', []) or msg.get('data', [])
            count = msg.get('count', 0)
            log_index = msg.get('logindex', 0)
            self.device_sn = msg.get('sn', msg.get('SN', self.device_sn))

            saved = 0
            new_records = []
            if isinstance(record, list):
                saved, new_records = await self._save_attlog_json(record)
            elif isinstance(record, str) and record:
                saved, new_records = await self._save_attlog(record)

            # Push to frontend via channel layer (async context)
            if new_records:
                await self._push_to_frontend(new_records)

            self.total_logs_received += count
            logger.warning(f"[ADMS-WS] sendlog: count={count}, logindex={log_index}, saved={saved}, new={len(new_records)}, total_received={self.total_logs_received}")

            # Xác nhận — result MUST be boolean true; logindex = cumulative total
            await self.send(text_data=json.dumps({
                'ret': 'sendlog',
                'result': True,
                'logindex': self.total_logs_received,
                'cloudtime': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            }))

        elif msg_type in ('senduser', 'userinfo', 'USERINFO'):
            record = msg.get('record', []) or msg.get('data', [])
            self.device_sn = msg.get('sn', msg.get('SN', self.device_sn))

            saved = 0
            if isinstance(record, list):
                saved = await self._save_userinfo_json(record)
            elif isinstance(record, str) and record:
                await self._save_userinfo(record)

            logger.warning(f"[ADMS-WS] senduser: saved={saved}")

            await self.send(text_data=json.dumps({
                'ret': 'senduser',
                'result': True,
                'cloudtime': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            }))

        else:
            # Check if it's a response to a server command
            ret = msg.get('ret', '')
            result = msg.get('result')
            reason_msg = msg.get('msg', '')
            if ret:
                # Map firmware command names back to user-facing names
                REVERSE_MAP = {'cleanlog': 'clearlog'}
                user_cmd = REVERSE_MAP.get(ret, ret)
                logger.warning(f"[ADMS-WS] Device response: ret={ret}, result={result}, msg={reason_msg}")
                await self._save_command_result(user_cmd, result, reason_msg)
            else:
                logger.warning(f"[ADMS-WS] Unknown JSON cmd: {msg_type}")
            await self.send(text_data=json.dumps({
                'ret': msg_type or ret or 'unknown',
                'result': True,
                'cloudtime': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            }))

    async def _handle_text_message(self, data):
        """Xử lý message dạng text (tab-separated hoặc key=value)."""
        logger.warning(f"[ADMS-WS] Text message: {data[:500]}")

        lines = data.strip().split('\n')

        # Kiểm tra có phải ATTLOG không
        for line in lines:
            line = line.strip()
            if not line:
                continue

            parts = line.split('\t')
            if len(parts) >= 2:
                # Có thể là ATTLOG: UserID\tTimestamp\t...
                try:
                    datetime.strptime(parts[1].strip().replace('/', '-'), '%Y-%m-%d %H:%M:%S')
                    saved, new_records = await self._save_attlog(data)
                    if new_records:
                        await self._push_to_frontend(new_records)
                    logger.warning(f"[ADMS-WS] Detected ATTLOG, saved {saved} records")
                    await self.send(text_data="OK")
                    return
                except (ValueError, IndexError):
                    pass

            # Kiểm tra key=value format
            if '=' in line:
                kv = {}
                for p in line.split('\t'):
                    if '=' in p:
                        k, v = p.split('=', 1)
                        kv[k.strip()] = v.strip()
                if kv.get('PIN') or kv.get('SN'):
                    logger.warning(f"[ADMS-WS] KV data: {kv}")

        # Gửi OK
        await self.send(text_data="OK")

    @database_sync_to_async
    def _record_contact(self, devinfo=None):
        from .zk_service import adms_record_contact
        adms_record_contact(self.device_sn, ip=self.device_ip, devinfo=devinfo)

    async def _dispatch_pending_commands(self):
        """Check and send any pending server→device commands."""
        commands = await self._get_pending_commands()
        for cmd_entry in commands:
            cmd = cmd_entry['cmd']
            params = cmd_entry.get('params', {})

            # Map user-facing command names to firmware command names
            COMMAND_MAP = {
                'clearlog': 'cleanlog',
                'reboot': 'reboot',
                'getuser': 'getuser',
            }
            fw_cmd = COMMAND_MAP.get(cmd, cmd)
            if fw_cmd != cmd:
                logger.warning(f"[ADMS-WS] Mapped command '{cmd}' → '{fw_cmd}'")
            logger.warning(f"[ADMS-WS] Dispatching command: {fw_cmd}")
            await self.send(text_data=json.dumps({
                'cmd': fw_cmd,
                'sn': self.device_sn,
                **params,
                'cloudtime': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            }))
            # Reboot: device won't respond, save result immediately
            if fw_cmd == 'reboot':
                await self._save_command_result('reboot', True, 'Đang khởi động lại...')

    @database_sync_to_async
    def _get_pending_commands(self):
        from .zk_service import adms_dequeue_commands
        return adms_dequeue_commands(self.device_sn)

    @database_sync_to_async
    def _save_command_result(self, cmd, result, msg):
        from .zk_service import adms_save_command_result
        adms_save_command_result(self.device_sn, cmd, result, msg)

    @database_sync_to_async
    def _save_attlog(self, body):
        from .models import Employee, AttendanceLog, SyncLog

        saved = 0
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
                ts = datetime.strptime(ts_str, '%Y-%m-%d %H:%M:%S')
                ts = timezone.make_aware(ts)
                status_val = int(parts[3]) if len(parts) > 3 else 0

                employee = Employee.objects.filter(user_id=user_id).first()
                _, created = AttendanceLog.objects.get_or_create(
                    user_id=user_id,
                    timestamp=ts,
                    defaults={
                        'employee': employee,
                        'status': int(parts[2]) if len(parts) > 2 else 0,
                        'punch': status_val,
                    }
                )
                if created:
                    saved += 1
                    new_records.append({
                        'user_id': user_id,
                        'employee_name': employee.name if employee else user_id,
                        'timestamp': _format_ts(ts),
                        'punch': status_val,
                    })
            except Exception as e:
                logger.warning(f"[ADMS-WS] Parse error '{line}': {e}")

        if saved > 0:
            SyncLog.objects.create(
                status='success',
                records_synced=saved,
                finished_at=timezone.now(),
            )

        return saved, new_records

    @database_sync_to_async
    def _save_attlog_json(self, records):
        """
        Lưu attendance từ JSON array.
        Format: [{"enrollid":1, "name":"...", "time":"2024-04-19 15:54:35", "inout":0, "mode":8}, ...]
        """
        from .models import Employee, AttendanceLog, SyncLog

        saved = 0
        new_records = []
        for rec in records:
            try:
                enroll_id = str(rec.get('enrollid', ''))
                name = rec.get('name', '')
                ts_str = rec.get('time', '')
                inout = rec.get('inout', 0)  # 0=check-in, 1=check-out
                mode = rec.get('mode', 0)    # verification mode

                if not enroll_id or not ts_str:
                    continue

                ts_str = ts_str.replace('/', '-')
                ts = datetime.strptime(ts_str, '%Y-%m-%d %H:%M:%S')
                ts = timezone.make_aware(ts)

                # Tìm hoặc tạo Employee
                employee = Employee.objects.filter(user_id=enroll_id).first()
                if not employee and name:
                    employee, _ = Employee.objects.get_or_create(
                        user_id=enroll_id,
                        defaults={
                            'uid': int(enroll_id) if enroll_id.isdigit() else 0,
                            'name': name,
                        }
                    )

                _, created = AttendanceLog.objects.get_or_create(
                    user_id=enroll_id,
                    timestamp=ts,
                    defaults={
                        'employee': employee,
                        'status': mode,
                        'punch': inout,
                    }
                )
                if created:
                    saved += 1
                    new_records.append({
                        'user_id': enroll_id,
                        'employee_name': name or enroll_id,
                        'timestamp': _format_ts(ts),
                        'punch': inout,
                    })
            except Exception as e:
                logger.warning(f"[ADMS-WS] JSON attlog parse error: {e} — rec={rec}")

        if saved > 0:
            SyncLog.objects.create(
                status='success',
                records_synced=saved,
                finished_at=timezone.now(),
            )

        return saved, new_records

    async def _push_to_frontend(self, new_records):
        """Push new attendance records to frontend via channel layer (async)."""
        try:
            await self.channel_layer.group_send(
                'attendance_live',
                {'type': 'attendance.push', 'data': {
                    'records': new_records,
                    'source': 'adms_ws',
                }}
            )
            logger.info(f"[ADMS-WS] Pushed {len(new_records)} records to frontend")
        except Exception as e:
            logger.warning(f"[ADMS-WS] Failed to push to frontend: {e}")

    @database_sync_to_async
    def _save_userinfo(self, body):
        from .models import Employee

        for line in body.strip().split('\n'):
            line = line.strip()
            if not line:
                continue
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
            except Exception as e:
                logger.warning(f"[ADMS-WS] User parse error: {e}")

    @database_sync_to_async
    def _save_userinfo_json(self, records):
        """
        Lưu user info từ JSON array.
        Format: [{"enrollid":1, "name":"...", "pri":0, ...}, ...]
        """
        from .models import Employee

        saved = 0
        for rec in records:
            try:
                enroll_id = str(rec.get('enrollid', ''))
                name = rec.get('name', '')
                if not enroll_id:
                    continue

                Employee.objects.update_or_create(
                    user_id=enroll_id,
                    defaults={
                        'uid': int(enroll_id) if enroll_id.isdigit() else 0,
                        'name': name or f'User {enroll_id}',
                        'privilege': rec.get('pri', 0),
                        'group_id': str(rec.get('grp', '')),
                        'card': rec.get('card', 0) or 0,
                    }
                )
                saved += 1
            except Exception as e:
                logger.warning(f"[ADMS-WS] JSON user parse error: {e}")
        return saved
