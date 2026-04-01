from django.urls import include, path
from rest_framework.routers import DefaultRouter

from requestsystem.views import RequestQuickTitleViewSet, RequestViewSet

router = DefaultRouter()
router.register("requests", RequestViewSet, basename="request")
router.register("request-quick-titles", RequestQuickTitleViewSet, basename="request-quick-title")

urlpatterns = [
    path("", include(router.urls)),
]
