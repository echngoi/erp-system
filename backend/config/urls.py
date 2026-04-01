"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.conf import settings
from django.conf.urls.static import static
from django.urls import include, path
from attendance.adms_views import (
    IClockCdataView, IClockGetRequestView, IClockDeviceCmdView,
    CatchAllDeviceView,
)

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/', include('users.urls')),
    path('api/', include('departments.urls')),
    path('api/', include('rbac.urls')),
    path('api/', include('requestsystem.urls')),
    path('api/', include('approvals.urls')),
    path('api/', include('communications.urls')),
    path('api/', include('notifications.urls')),
    path('api/attendance/', include('attendance.urls')),

    # iclock / ADMS endpoints — máy chấm công gửi dữ liệu đến đây
    path('iclock/cdata', IClockCdataView.as_view(), name='iclock-cdata'),
    path('iclock/cdata/', IClockCdataView.as_view(), name='iclock-cdata-slash'),
    path('iclock/getrequest', IClockGetRequestView.as_view(), name='iclock-getrequest'),
    path('iclock/getrequest/', IClockGetRequestView.as_view(), name='iclock-getrequest-slash'),
    path('iclock/devicecmd', IClockDeviceCmdView.as_view(), name='iclock-devicecmd'),
    path('iclock/devicecmd/', IClockDeviceCmdView.as_view(), name='iclock-devicecmd-slash'),
    path('cdata', IClockCdataView.as_view(), name='cdata-direct'),
    path('cdata/', IClockCdataView.as_view(), name='cdata-direct-slash'),
    path('iclock/<path:subpath>', CatchAllDeviceView.as_view(), name='iclock-catchall'),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
