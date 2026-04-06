"""
API endpoint nhận dữ liệu chấm công từ PC Local (pyzk sync).

Kiến trúc:
  [Máy CC AI06F] ←LAN→ [PC Local: pyzk pull] →HTTPS→ [VPS: sync_api_views]

Authentication: Header `X-Sync-Key` phải khớp với setting LOCAL_SYNC_KEY.
"""
import logging
from datetime import datetime
from django.conf import settings
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from .models import Employee, AttendanceLog, SyncLog

logger = logging.getLogger(__name__)


def _check_sync_key(request):
    """Validate X-Sync-Key header against LOCAL_SYNC_KEY setting."""
    expected = getattr(settings, 'LOCAL_SYNC_KEY', None)
    if not expected:
        return False, "LOCAL_SYNC_KEY not configured on server"
    provided = request.META.get('HTTP_X_SYNC_KEY', '')
    if not provided or provided != expected:
        return False, "Invalid sync key"
    return True, ""


class LocalSyncAttendanceView(APIView):
    """Nhận attendance logs từ PC Local.

    POST /api/attendance/local-sync/attendance/
    Headers: X-Sync-Key: <secret>
    Body: {
        "records": [
            {"user_id": "1", "timestamp": "2026-04-06 08:05:33", "status": 0, "punch": 0},
            ...
        ]
    }
    """
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        ok, err = _check_sync_key(request)
        if not ok:
            return Response({'error': err}, status=status.HTTP_403_FORBIDDEN)

        records = request.data.get('records', [])
        if not records:
            return Response({'error': 'No records'}, status=status.HTTP_400_BAD_REQUEST)

        saved = 0
        skipped = 0
        errors = []
        ws_records = []

        for rec in records:
            try:
                user_id = str(rec.get('user_id', '')).strip()
                ts_str = str(rec.get('timestamp', '')).strip()
                rec_status = int(rec.get('status', 0))
                punch = int(rec.get('punch', 0))

                if not user_id or not ts_str:
                    continue

                ts_str = ts_str.replace('/', '-')
                ts = datetime.strptime(ts_str, '%Y-%m-%d %H:%M:%S')
                ts = timezone.make_aware(ts)

                employee = Employee.objects.select_related(
                    'linked_user__department'
                ).filter(user_id=user_id).first()

                _, created = AttendanceLog.objects.get_or_create(
                    user_id=user_id,
                    timestamp=ts,
                    defaults={
                        'employee': employee,
                        'status': rec_status,
                        'punch': punch,
                    }
                )
                if created:
                    saved += 1
                    dept = ''
                    if employee:
                        linked = getattr(employee, 'linked_user', None)
                        if linked and linked.department:
                            dept = linked.department.name
                    ws_records.append({
                        'user_id': user_id,
                        'employee_name': employee.display_name if employee else user_id,
                        'employee_code': employee.employee_code if employee else '',
                        'department': dept,
                        'timestamp': timezone.localtime(ts).strftime('%Y-%m-%d %H:%M:%S'),
                        'punch': punch,
                    })
                else:
                    skipped += 1
            except Exception as e:
                errors.append(str(e))

        # Notify WebSocket for live monitor
        if ws_records:
            self._notify_websocket(ws_records)

        if saved > 0:
            SyncLog.objects.create(
                status='success',
                records_synced=saved,
                finished_at=timezone.now(),
            )
            logger.info(f"[LocalSync] Saved {saved} attendance records, skipped {skipped}")

        return Response({
            'saved': saved,
            'skipped': skipped,
            'errors': errors[:10],
        })

    def _notify_websocket(self, records):
        """Push to WebSocket channel layer (same as ZK push server does)."""
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
                            'records': records,
                            'source': 'local_sync',
                        },
                    },
                )
        except Exception as e:
            logger.debug(f"[LocalSync] WebSocket notify error: {e}")


class LocalSyncEmployeesView(APIView):
    """Nhận employee list từ PC Local.

    POST /api/attendance/local-sync/employees/
    Headers: X-Sync-Key: <secret>
    Body: {
        "employees": [
            {"uid": 1, "user_id": "1", "name": "Nguyen Van A", "privilege": 0, "group_id": "", "card": 0},
            ...
        ]
    }
    """
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        ok, err = _check_sync_key(request)
        if not ok:
            return Response({'error': err}, status=status.HTTP_403_FORBIDDEN)

        employees = request.data.get('employees', [])
        if not employees:
            return Response({'error': 'No employees'}, status=status.HTTP_400_BAD_REQUEST)

        created_count = 0
        updated_count = 0

        for emp in employees:
            try:
                uid = int(emp.get('uid', 0))
                user_id = str(emp.get('user_id', '')).strip()
                name = str(emp.get('name', '')).strip()

                if not user_id:
                    continue

                obj, created = Employee.objects.update_or_create(
                    user_id=user_id,
                    defaults={
                        'uid': uid,
                        'name': name or f'User {user_id}',
                        'privilege': int(emp.get('privilege', 0)),
                        'group_id': str(emp.get('group_id', '')),
                        'card': int(emp.get('card', 0)),
                    }
                )
                if created:
                    created_count += 1
                else:
                    updated_count += 1
            except Exception as e:
                logger.warning(f"[LocalSync] Employee save error: {e}")

        logger.info(f"[LocalSync] Employees: {created_count} created, {updated_count} updated")
        return Response({
            'created': created_count,
            'updated': updated_count,
        })
