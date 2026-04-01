from django.urls import include, path
from rest_framework.routers import DefaultRouter

from communications.views import CustomGroupViewSet, MessageViewSet

router = DefaultRouter()
router.register("groups", CustomGroupViewSet, basename="group")
router.register("messages", MessageViewSet, basename="message")

urlpatterns = [
    path("", include(router.urls)),
]
