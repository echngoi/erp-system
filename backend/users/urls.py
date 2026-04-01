from django.urls import include, path
from rest_framework.routers import DefaultRouter

from users.auth_views import LoginView, RefreshTokenView
from users.views import UserViewSet

router = DefaultRouter()
router.register("users", UserViewSet, basename="user")

urlpatterns = [
    path("auth/login/", LoginView.as_view(), name="auth-login"),
    path("auth/refresh/", RefreshTokenView.as_view(), name="auth-refresh"),
    path("", include(router.urls)),
]
