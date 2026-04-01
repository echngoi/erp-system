import logging

from django.contrib.auth import get_user_model
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from rbac.utils import get_user_permissions, get_user_role_names


logger = logging.getLogger(__name__)


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token["roles"] = [str(name).lower() for name in get_user_role_names(user)]
        return token

    def validate(self, attrs):
        username_field = self.username_field
        username = attrs.get(username_field)
        password = attrs.get("password")
        request = self.context.get("request")
        client_ip = request.META.get("REMOTE_ADDR") if request else None

        data = None
        try:
            data = super().validate(attrs)
        except AuthenticationFailed as exc:
            reason = "invalid_credentials"
            user_model = get_user_model()
            user = None
            if username:
                user = user_model._default_manager.filter(**{username_field: username}).first()

            if not username or not password:
                reason = "missing_credentials"
            elif not user:
                reason = "user_not_found"
            elif not user.is_active:
                reason = "user_inactive"
            elif not user.check_password(password):
                reason = "invalid_password"

            logger.warning(
                "Login failed: reason=%s username=%s ip=%s",
                reason,
                username,
                client_ip,
            )
            # Keep external response generic to avoid leaking account existence.
            raise AuthenticationFailed("Sai tên đăng nhập hoặc mật khẩu.") from exc

        user = self.user

        logger.info(
            "Login success: user_id=%s username=%s ip=%s",
            user.id,
            user.username,
            client_ip,
        )

        data["user"] = {
            "id": user.id,
            "username": user.username,
            "full_name": user.full_name,
            "roles": [str(name).lower() for name in get_user_role_names(user)],
            "permissions": get_user_permissions(user),
            "attendance_employee_id": user.attendance_employee.user_id if user.attendance_employee_id else None,
        }
        return data


class LoginView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer


class RefreshTokenView(TokenRefreshView):
    pass
