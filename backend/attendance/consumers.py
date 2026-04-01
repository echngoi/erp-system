import json
import asyncio
import logging
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.utils import timezone as tz

logger = logging.getLogger(__name__)

def _format_ts(dt):
    """Format datetime to VN local time string."""
    return tz.localtime(dt).strftime('%Y-%m-%d %H:%M:%S') if dt else ''


class AttendanceConsumer(AsyncWebsocketConsumer):
    """WebSocket consumer for real-time attendance monitoring.

    Hỗ trợ 2 chế độ:
      - ADMS push: nhận event từ adms_views khi máy gửi chấm công
      - Binary poll: poll thiết bị trực tiếp (fallback)
    """

    async def connect(self):
        self.group_name = 'attendance_live'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        protocol = await self._get_protocol()
        await self.send(text_data=json.dumps({
            'type': 'connected',
            'message': 'Kết nối thành công. Đang theo dõi chấm công...',
            'protocol': protocol,
        }))

        # Gửi bản ghi gần nhất từ DB ngay khi kết nối
        initial = await self._get_latest_records()
        if initial['records']:
            await self.send(text_data=json.dumps({
                'type': 'attendance_update',
                'records': initial['records'],
                'total': initial['total'],
                'source': 'db_initial',
            }))

        # Chỉ poll nếu binary mode; ADMS mode nhận qua push event
        self.polling = (protocol == 'binary')
        if self.polling:
            asyncio.create_task(self.poll_device())

    async def disconnect(self, close_code):
        self.polling = False
        await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        """Handle commands from frontend (refresh, force_sync)."""
        if not text_data:
            return
        try:
            msg = json.loads(text_data)
        except json.JSONDecodeError:
            return

        action = msg.get('action', '')
        if action == 'refresh':
            # Re-fetch latest records from DB
            data = await self._get_latest_records()
            if data['records']:
                await self.send(text_data=json.dumps({
                    'type': 'attendance_update',
                    'records': data['records'],
                    'total': data['total'],
                    'source': 'db_refresh',
                }))
        elif action == 'force_sync':
            # Device doesn't support getlog - reboot to force reconnect & log push
            await self._enqueue_reboot()
            await self.send(text_data=json.dumps({
                'type': 'info',
                'message': 'Đã gửi lệnh khởi động lại máy chấm công. Máy sẽ tự đồng bộ sau khi khởi động (~30s)...',
            }))

    @database_sync_to_async
    def _enqueue_reboot(self):
        from .zk_service import adms_enqueue_command, adms_get_last_contact
        contact = adms_get_last_contact()
        sn = contact['sn'] if contact else None
        adms_enqueue_command('reboot', sn=sn)

    async def attendance_push(self, event):
        """Nhận event từ ADMS push (channel layer group_send)."""
        data = event.get('data', {})
        records = data.get('records') if isinstance(data, dict) and 'records' in data else [data]
        total = await self._get_total_count()
        await self.send(text_data=json.dumps({
            'type': 'attendance_update',
            'records': records,
            'total': total,
            'source': 'adms_push',
        }))

    @database_sync_to_async
    def _get_protocol(self):
        from .zk_service import zk_service, ADMSService
        return 'adms' if isinstance(zk_service, ADMSService) else 'binary'

    @database_sync_to_async
    def _get_latest_records(self, limit=20):
        from .models import AttendanceLog
        qs = AttendanceLog.objects.select_related('employee__linked_user__department').order_by('-timestamp')[:limit]
        records = []
        for log in qs:
            emp = log.employee
            dept = ''
            if emp:
                linked = getattr(emp, 'linked_user', None)
                if linked and linked.department:
                    dept = linked.department.name
            records.append({
                'user_id': log.user_id,
                'employee_name': emp.display_name if emp else log.user_id,
                'employee_code': emp.employee_code if emp else '',
                'department': dept,
                'timestamp': _format_ts(log.timestamp),
                'punch': log.punch,
            })
        total = AttendanceLog.objects.count()
        return {'records': records, 'total': total}

    @database_sync_to_async
    def _get_total_count(self):
        from .models import AttendanceLog
        return AttendanceLog.objects.count()

    async def poll_device(self):
        """Poll device every 5 seconds (binary mode only)."""
        from .zk_service import zk_service
        last_count = 0
        while self.polling:
            try:
                records = await asyncio.to_thread(zk_service.get_all_attendance)
                if len(records) != last_count:
                    last_count = len(records)
                    latest = sorted(records, key=lambda x: x['timestamp'] or '', reverse=True)[:5]
                    await self.send(text_data=json.dumps({
                        'type': 'attendance_update',
                        'records': latest,
                        'total': len(records),
                    }))
            except Exception as e:
                await self.send(text_data=json.dumps({
                    'type': 'error',
                    'message': str(e),
                }))
            await asyncio.sleep(5)

    async def attendance_message(self, event):
        await self.send(text_data=json.dumps(event))
