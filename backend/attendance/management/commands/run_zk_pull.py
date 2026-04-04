"""
ZK Periodic Pull — Django Management Command
=============================================

Periodically connects to attendance machine via pyzk (ZKTeco binary protocol)
and pulls ALL attendance records to database.

This is the RELIABLE backup for ZK Binary Push (port 7005).
Even if push notifications get stuck, pull ensures no data is lost.

Architecture:
    VPS (123.30.48.72)  ──TCP:4370──►  Router NAT (113.160.150.125:4370)
                                               │
                                        Port forward
                                               │
                                        Máy CC (192.168.1.225:4370)
                                        ◄── pyzk binary protocol ──►
                                        get_attendance() → save to DB

Requirements in .env.production:
    ZK_DEVICE_IP=113.160.150.125   ← WAN IP của router văn phòng
    ZK_DEVICE_PORT=4370             ← ZKTeco binary protocol port
    ZK_PROTOCOL=binary              ← kích hoạt ZKBinaryService

Usage:
    python manage.py run_zk_pull [--interval 60] [--once]
"""
import time
import logging
from datetime import datetime

from django.core.management.base import BaseCommand
from django.utils import timezone
from django.conf import settings

logger = logging.getLogger('attendance.zk_pull')


class Command(BaseCommand):
    help = 'Periodically pull attendance data from ZK device via pyzk binary protocol'

    def add_arguments(self, parser):
        parser.add_argument(
            '--interval',
            type=int,
            default=60,
            help='Seconds between pulls (default: 60)',
        )
        parser.add_argument(
            '--once',
            action='store_true',
            help='Pull once then exit (for testing / manual sync)',
        )

    def handle(self, *args, **options):
        interval = options['interval']
        once = options['once']

        ip = getattr(settings, 'ZK_DEVICE_IP', 'not_set')
        port = getattr(settings, 'ZK_DEVICE_PORT', 4370)

        if once:
            logger.info(f'[ZK-PULL] One-time pull from {ip}:{port}')
            self.stdout.write(f'[ZK-PULL] One-time pull from {ip}:{port}...')
            new_count = self._pull_once()
            self.stdout.write(self.style.SUCCESS(f'[ZK-PULL] Done. {new_count} new records saved.'))
            return

        logger.info(f'[ZK-PULL] Starting periodic pull every {interval}s from {ip}:{port}')
        self.stdout.write(f'[ZK-PULL] Starting. Target: {ip}:{port}, interval: {interval}s')

        while True:
            try:
                self._pull_once()
            except Exception as e:
                logger.error(f'[ZK-PULL] Unexpected error: {e}', exc_info=True)
            time.sleep(interval)

    def _pull_once(self):
        """Connect to device, pull all attendance, save new records to DB.

        Uses get_or_create with (user_id, timestamp) as unique key —
        safe to call multiple times, never creates duplicates.

        Returns number of new records saved.
        """
        from attendance.zk_service import ZKBinaryService
        from attendance.models import Employee, AttendanceLog, SyncLog

        svc = ZKBinaryService()
        try:
            records = svc.get_all_attendance()
        except Exception as e:
            logger.warning(f'[ZK-PULL] Cannot connect to device: {e}')
            return 0

        if not records:
            logger.info('[ZK-PULL] Device returned 0 records')
            return 0

        new_count = 0
        new_records_ws = []

        for rec in records:
            if not rec.get('timestamp'):
                continue
            try:
                ts_str = rec['timestamp']
                ts = datetime.strptime(ts_str, '%Y-%m-%d %H:%M:%S')
                ts = timezone.make_aware(ts)
                user_id = str(rec['user_id'])

                employee = Employee.objects.filter(user_id=user_id).first()
                _, created = AttendanceLog.objects.get_or_create(
                    user_id=user_id,
                    timestamp=ts,
                    defaults={
                        'employee': employee,
                        'status': rec.get('status', 0),
                        'punch': rec.get('punch', 0),
                    }
                )
                if created:
                    new_count += 1
                    new_records_ws.append({
                        'user_id': user_id,
                        'employee_name': employee.name if employee else user_id,
                        'timestamp': timezone.localtime(ts).strftime('%Y-%m-%d %H:%M:%S'),
                        'punch': rec.get('punch', 0),
                    })
            except Exception as e:
                logger.warning(f'[ZK-PULL] Error saving record {rec}: {e}')

        if new_count > 0:
            logger.warning(
                f'[ZK-PULL] ✓ Saved {new_count} new records '
                f'(device total: {len(records)})'
            )
            self._notify_websocket(new_records_ws)
            try:
                SyncLog.objects.create(
                    status='success',
                    records_synced=new_count,
                    finished_at=timezone.now(),
                )
            except Exception:
                pass
        else:
            logger.info(
                f'[ZK-PULL] No new records '
                f'(device has {len(records)} total, all already in DB)'
            )

        return new_count

    def _notify_websocket(self, records_list):
        """Push new records to WebSocket channel for realtime UI update."""
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
                            'source': 'zk_pull',
                        },
                    }
                )
        except Exception as e:
            logger.debug(f'[ZK-PULL] WebSocket notify skipped: {e}')
