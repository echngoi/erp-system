from rest_framework import serializers
from .models import Employee, AttendanceLog, SyncLog, AttendancePermission, WorkShift, LateEarlyRule, PenaltyConfig


class WorkShiftSerializer(serializers.ModelSerializer):
    shift_type_label = serializers.SerializerMethodField()

    class Meta:
        model = WorkShift
        fields = '__all__'

    def get_shift_type_label(self, obj):
        return obj.get_shift_type_display()

    def validate(self, data):
        st = data.get('shift_type', getattr(self.instance, 'shift_type', 'hc'))
        if st == '3punch' and not data.get('mid_time', getattr(self.instance, 'mid_time', None)):
            raise serializers.ValidationError({'mid_time': 'Ca 3 lần chấm cần có giờ giữa ca.'})
        if st == '4punch':
            if not data.get('mid_time', getattr(self.instance, 'mid_time', None)):
                raise serializers.ValidationError({'mid_time': 'Ca 4 lần chấm cần có giờ ra ca 1.'})
            if not data.get('mid_time2', getattr(self.instance, 'mid_time2', None)):
                raise serializers.ValidationError({'mid_time2': 'Ca 4 lần chấm cần có giờ vào ca 2.'})
        return data


class EmployeeSerializer(serializers.ModelSerializer):
    privilege_label = serializers.SerializerMethodField()
    display_name = serializers.SerializerMethodField()
    linked_username = serializers.SerializerMethodField()
    linked_department = serializers.SerializerMethodField()
    shift_name = serializers.CharField(source='shift.name', read_only=True, default=None)

    class Meta:
        model = Employee
        fields = '__all__'

    def get_privilege_label(self, obj):
        labels = {0: 'Nhân viên', 14: 'Quản trị viên', 1: 'Người dùng'}
        return labels.get(obj.privilege, 'Không xác định')

    def get_display_name(self, obj):
        return obj.display_name

    def get_linked_username(self, obj):
        linked = getattr(obj, 'linked_user', None)
        if linked:
            return linked.username
        return None

    def get_linked_department(self, obj):
        linked = getattr(obj, 'linked_user', None)
        if linked and linked.department:
            return linked.department.name
        return None


class AttendanceLogSerializer(serializers.ModelSerializer):
    employee_name = serializers.SerializerMethodField()
    employee_code = serializers.SerializerMethodField()
    employee_username = serializers.SerializerMethodField()
    employee_department = serializers.SerializerMethodField()
    punch_label = serializers.SerializerMethodField()

    class Meta:
        model = AttendanceLog
        fields = '__all__'

    def get_employee_name(self, obj):
        if obj.employee:
            return obj.employee.display_name
        return obj.user_id

    def get_employee_code(self, obj):
        if obj.employee:
            return obj.employee.employee_code or ''
        return ''

    def get_employee_username(self, obj):
        if obj.employee:
            linked = getattr(obj.employee, 'linked_user', None)
            if linked:
                return linked.username
        return ''

    def get_employee_department(self, obj):
        if obj.employee:
            linked = getattr(obj.employee, 'linked_user', None)
            if linked and linked.department:
                return linked.department.name
        return ''

    def get_punch_label(self, obj):
        return obj.get_punch_display()


class SyncLogSerializer(serializers.ModelSerializer):
    duration = serializers.SerializerMethodField()

    class Meta:
        model = SyncLog
        fields = '__all__'

    def get_duration(self, obj):
        if obj.finished_at and obj.started_at:
            delta = obj.finished_at - obj.started_at
            return round(delta.total_seconds(), 2)
        return None


class AttendancePermissionSerializer(serializers.ModelSerializer):
    user_name = serializers.CharField(source='user.full_name', read_only=True, default='')
    username = serializers.CharField(source='user.username', read_only=True, default='')
    department_name = serializers.CharField(source='department.name', read_only=True, default='')
    page_display = serializers.CharField(source='get_page_display', read_only=True)

    class Meta:
        model = AttendancePermission
        fields = [
            'id', 'user', 'department', 'page', 'can_view_all', 'created_at',
            'user_name', 'username', 'department_name', 'page_display',
        ]

    def validate(self, data):
        if not data.get('user') and not data.get('department'):
            raise serializers.ValidationError('Phải chọn nhân viên hoặc phòng ban.')
        return data


class LateEarlyRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = LateEarlyRule
        fields = '__all__'


class PenaltyConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = PenaltyConfig
        fields = '__all__'
