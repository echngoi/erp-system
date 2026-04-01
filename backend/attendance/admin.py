from django.contrib import admin
from .models import Employee, AttendanceLog, SyncLog, WorkShift, LateEarlyRule, PenaltyConfig


@admin.register(WorkShift)
class WorkShiftAdmin(admin.ModelAdmin):
    list_display = ['name', 'shift_type', 'start_time', 'end_time', 'mid_time', 'mid_time2']
    list_filter = ['shift_type']


@admin.register(Employee)
class EmployeeAdmin(admin.ModelAdmin):
    list_display = ['user_id', 'employee_code', 'name', 'privilege', 'department', 'shift', 'is_active', 'synced_at']
    list_editable = ['employee_code', 'is_active', 'shift']
    search_fields = ['user_id', 'name', 'employee_code']
    list_filter = ['privilege', 'department', 'is_active', 'shift']


@admin.register(AttendanceLog)
class AttendanceLogAdmin(admin.ModelAdmin):
    list_display = ['user_id', 'timestamp', 'punch', 'status', 'synced_at']
    search_fields = ['user_id']
    list_filter = ['punch', 'status']
    date_hierarchy = 'timestamp'


@admin.register(SyncLog)
class SyncLogAdmin(admin.ModelAdmin):
    list_display = ['started_at', 'finished_at', 'status', 'records_synced']
    list_filter = ['status']


@admin.register(LateEarlyRule)
class LateEarlyRuleAdmin(admin.ModelAdmin):
    list_display = ['shift', 'rule_type', 'from_minutes', 'to_minutes', 'label']
    list_filter = ['shift', 'rule_type']


@admin.register(PenaltyConfig)
class PenaltyConfigAdmin(admin.ModelAdmin):
    list_display = ['shift', 'rule_type', 'from_count', 'to_count', 'penalty_amount']
    list_filter = ['shift', 'rule_type']
