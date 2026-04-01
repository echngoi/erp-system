from django.urls import include, path
from rest_framework.routers import DefaultRouter

from rbac.views import PermissionViewSet, RoleViewSet

router = DefaultRouter()
router.register("permissions", PermissionViewSet, basename="permission")
router.register("roles", RoleViewSet, basename="role")

urlpatterns = [
    path("", include(router.urls)),
]
