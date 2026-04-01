from rest_framework.permissions import BasePermission

from rbac.utils import user_has_permission


def permission_required(code: str):
    """
    Factory that returns a DRF permission class requiring the given permission code.

    Usage:
        class MyView(APIView):
            permission_classes = [permission_required("create_request")]

    The returned class is a proper DRF BasePermission subclass and can be combined
    with other permission classes:
        permission_classes = [IsAuthenticated, permission_required("approve_request")]
    """

    class _RequiredPermission(BasePermission):
        message = f"Permission '{code}' is required."

        def has_permission(self, request, view):
            return user_has_permission(request.user, code)

    _RequiredPermission.__name__ = f"HasPermission[{code}]"
    _RequiredPermission.__qualname__ = f"HasPermission[{code}]"
    return _RequiredPermission
