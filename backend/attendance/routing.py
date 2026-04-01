from django.urls import re_path
from . import consumers
from .adms_consumer import ADMSDeviceConsumer

websocket_urlpatterns = [
    re_path(r'ws/attendance/$', consumers.AttendanceConsumer.as_asgi()),
    # Ronald Jack ADMS push via WebSocket
    re_path(r'pub/chat$', ADMSDeviceConsumer.as_asgi()),
    re_path(r'pub/chat/$', ADMSDeviceConsumer.as_asgi()),
]
