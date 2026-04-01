from rest_framework.permissions import BasePermission

from rbac.utils import user_has_any_role, user_has_role


class IsAdmin(BasePermission):
    """Allow access only to users assigned RBAC role 'admin'."""

    message = "Only administrators are allowed to perform this action."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and user_has_role(request.user, "admin"))


class IsAdminOrManager(BasePermission):
    """Allow access to users assigned RBAC role 'admin' or 'manager'."""

    message = "Only administrators or managers are allowed to perform this action."

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and user_has_any_role(request.user, ("admin", "manager"))
        )
