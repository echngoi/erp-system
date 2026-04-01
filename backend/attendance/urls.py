from django.urls import path
from . import views

urlpatterns = [
    # Device management
    path('device/status/',   views.DeviceStatusView.as_view(),   name='device-status'),
    path('device/time/',     views.DeviceTimeView.as_view(),     name='device-time'),
    path('device/restart/',  views.DeviceRestartView.as_view(),  name='device-restart'),
    path('device/protocol/', views.DeviceProtocolView.as_view(), name='device-protocol'),
    path('device/command/',  views.DeviceCommandView.as_view(),  name='device-command'),

    # Sync operations
    path('sync/users/',      views.SyncUsersView.as_view(),      name='sync-users'),
    path('sync/attendance/', views.SyncAttendanceView.as_view(), name='sync-attendance'),
    path('sync/logs/',       views.SyncLogListView.as_view(),    name='sync-logs'),

    # Data
    path('employees/',               views.EmployeeListView.as_view(),        name='employee-list'),
    path('employees/<int:pk>/active/', views.EmployeeToggleActiveView.as_view(), name='employee-toggle-active'),
    path('employees/bulk-active/',       views.EmployeeBulkToggleActiveView.as_view(), name='employee-bulk-toggle-active'),
    path('employees/assign-shift/',      views.EmployeeAssignShiftView.as_view(),      name='employee-assign-shift'),
    path('attendance/',       views.AttendanceListView.as_view(), name='attendance-list'),
    path('attendance/live/',  views.LiveAttendanceView.as_view(), name='attendance-live'),
    path('attendance/clear/', views.ClearAttendanceView.as_view(),name='attendance-clear'),

    # Dashboard
    path('dashboard/stats/', views.DashboardStatsView.as_view(), name='dashboard-stats'),

    # Report
    path('report/',        views.AttendanceReportView.as_view(),       name='attendance-report'),
    path('report/export/', views.AttendanceReportExportView.as_view(), name='attendance-report-export'),

    # ADMS Push — máy chấm công tự đẩy dữ liệu về đây
    path('adms/push/', views.ADMSPushView.as_view(), name='adms-push'),

    # Attendance permissions
    path('permissions/',          views.AttendancePermissionListCreateView.as_view(), name='att-perm-list-create'),
    path('permissions/<int:pk>/', views.AttendancePermissionDeleteView.as_view(),     name='att-perm-delete'),
    path('my-info/',              views.MyAttendanceInfoView.as_view(),               name='att-my-info'),
    path('mapping/',              views.UserAttendanceEmployeeMappingView.as_view(),  name='att-mapping'),

    # Work shifts
    path('shifts/',              views.WorkShiftListCreateView.as_view(),  name='shift-list-create'),
    path('shifts/<int:pk>/',     views.WorkShiftDetailView.as_view(),      name='shift-detail'),

    # Late/Early rules & Penalty configs
    path('late-early-rules/',           views.LateEarlyRuleListCreateView.as_view(), name='late-early-rule-list'),
    path('late-early-rules/<int:pk>/',  views.LateEarlyRuleDetailView.as_view(),     name='late-early-rule-detail'),
    path('late-early-rules/bulk/',      views.LateEarlyRuleBulkView.as_view(),       name='late-early-rule-bulk'),
    path('penalty-configs/',            views.PenaltyConfigListCreateView.as_view(),  name='penalty-config-list'),
    path('penalty-configs/<int:pk>/',   views.PenaltyConfigDetailView.as_view(),      name='penalty-config-detail'),
    path('penalty-configs/bulk/',       views.PenaltyConfigBulkView.as_view(),        name='penalty-config-bulk'),
]
