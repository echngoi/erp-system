from django.conf import settings
from django.db import models


class Permission(models.Model):
    """A single, granular action that can be allowed or denied."""

    code = models.CharField(max_length=100, unique=True)
    name = models.CharField(max_length=255)

    class Meta:
        db_table = "rbac_permissions"
        ordering = ["code"]

    def __str__(self) -> str:
        return f"{self.name} ({self.code})"


class Role(models.Model):
    """A named collection of permissions."""

    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True)
    permissions = models.ManyToManyField(
        Permission,
        through="RolePermission",
        related_name="roles",
        blank=True,
    )

    class Meta:
        db_table = "rbac_roles"
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class RolePermission(models.Model):
    """Through-table linking a Role to a Permission."""

    role = models.ForeignKey(
        Role, on_delete=models.CASCADE, related_name="role_permissions"
    )
    permission = models.ForeignKey(
        Permission, on_delete=models.CASCADE, related_name="role_permissions"
    )

    class Meta:
        db_table = "rbac_role_permissions"
        unique_together = [["role", "permission"]]

    def __str__(self) -> str:
        return f"{self.role} → {self.permission.code}"


class UserRole(models.Model):
    """Links a User to zero or more Roles."""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="user_roles",
    )
    role = models.ForeignKey(
        Role, on_delete=models.CASCADE, related_name="user_roles"
    )

    class Meta:
        db_table = "rbac_user_roles"
        unique_together = [["user", "role"]]

    def __str__(self) -> str:
        return f"{self.user} → {self.role}"
