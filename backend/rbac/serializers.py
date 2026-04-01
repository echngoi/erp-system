from rest_framework import serializers

from rbac.models import Permission, Role, RolePermission, UserRole


class PermissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Permission
        fields = ["id", "code", "name"]


class RoleSerializer(serializers.ModelSerializer):
    permissions = PermissionSerializer(many=True, read_only=True)

    class Meta:
        model = Role
        fields = ["id", "name", "description", "permissions"]


class RoleWriteSerializer(serializers.ModelSerializer):
    """Used for create/update — excludes nested permissions (managed via assign endpoint)."""

    class Meta:
        model = Role
        fields = ["id", "name", "description"]


class AssignPermissionsSerializer(serializers.Serializer):
    permission_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        allow_empty=True,
        help_text="Full list of permission IDs to assign to this role (replaces existing).",
    )


class AssignRolesSerializer(serializers.Serializer):
    role_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        allow_empty=True,
        help_text="Full list of role IDs to assign to this user (replaces existing).",
    )
