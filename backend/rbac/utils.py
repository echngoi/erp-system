from rbac.models import Permission


def get_user_role_names(user) -> list[str]:
    """Return RBAC role names assigned to `user` in lowercase."""
    if not user or not user.is_authenticated:
        return []

    if getattr(user, "is_superuser", False):
        return ["admin"]

    role_names = list(
        user.user_roles.select_related("role")
        .values_list("role__name", flat=True)
    )

    if role_names:
        return [str(name).lower() for name in role_names]

    return ["staff"]


def user_has_role(user, role_name: str) -> bool:
    """Return True when `user` has the RBAC role name (case-insensitive)."""
    if not user or not user.is_authenticated:
        return False
    if getattr(user, "is_superuser", False):
        return True

    expected = str(role_name).lower()
    return user.user_roles.filter(role__name__iexact=expected).exists()


def user_has_any_role(user, role_names: list[str] | tuple[str, ...]) -> bool:
    """Return True when `user` has at least one of the given RBAC role names."""
    if not user or not user.is_authenticated:
        return False
    if getattr(user, "is_superuser", False):
        return True

    normalized = [str(name).lower() for name in role_names if name]
    if not normalized:
        return False

    return user.user_roles.filter(role__name__in=normalized).exists()


def get_user_permissions(user) -> list[str]:
    """
    Return a list of permission codes held by `user` via their assigned roles.

    Traversal: Permission → RolePermission → Role → UserRole → User
    """
    if not user or not user.is_authenticated:
        return []

    if getattr(user, "is_superuser", False):
        return list(Permission.objects.values_list("code", flat=True).distinct())

    return list(
        Permission.objects.filter(
            role_permissions__role__user_roles__user=user
        )
        .values_list("code", flat=True)
        .distinct()
    )


def user_has_permission(user, code: str) -> bool:
    """Return True if `user` holds the given permission code."""
    if not user or not user.is_authenticated:
        return False
    if getattr(user, "is_superuser", False):
        return True
    return Permission.objects.filter(
        code=code, role_permissions__role__user_roles__user=user
    ).exists()
