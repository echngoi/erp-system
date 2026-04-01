from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from rbac.models import Permission, Role, RolePermission
from rbac.serializers import (
    AssignPermissionsSerializer,
    PermissionSerializer,
    RoleSerializer,
    RoleWriteSerializer,
)
from users.permissions import IsAdmin


class PermissionViewSet(viewsets.ModelViewSet):
    """
    CRUD for Permission objects.
    Only ADMIN users may manage permissions.
    """

    queryset = Permission.objects.all()
    serializer_class = PermissionSerializer
    permission_classes = [IsAdmin]


class RoleViewSet(viewsets.ModelViewSet):
    """
    CRUD for Role objects + permission assignment.
    Only ADMIN users may manage roles.

    Extra endpoints:
      GET  /roles/:id/permissions/         – list permissions for this role
      POST /roles/:id/assign-permissions/  – replace all permissions for this role
    """

    permission_classes = [IsAdmin]

    def get_queryset(self):
        return Role.objects.prefetch_related("permissions").all()

    def get_serializer_class(self):
        if self.action in ("create", "update", "partial_update"):
            return RoleWriteSerializer
        return RoleSerializer

    # ------------------------------------------------------------------ #
    # Permission assignment                                                 #
    # ------------------------------------------------------------------ #

    @action(detail=True, methods=["get"], url_path="permissions")
    def list_permissions(self, request, pk=None):
        """GET /roles/:id/permissions/ — list all permissions for this role."""
        role = self.get_object()
        return Response(PermissionSerializer(role.permissions.all(), many=True).data)

    @action(detail=True, methods=["post"], url_path="assign-permissions")
    def assign_permissions(self, request, pk=None):
        """
        POST /roles/:id/assign-permissions/
        Body: { "permission_ids": [1, 2, 3] }
        Replaces the full set of permissions for this role.
        """
        role = self.get_object()
        serializer = AssignPermissionsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        permission_ids = serializer.validated_data["permission_ids"]

        # Validate every submitted ID exists
        existing_ids = set(
            Permission.objects.filter(id__in=permission_ids).values_list("id", flat=True)
        )
        invalid_ids = set(permission_ids) - existing_ids
        if invalid_ids:
            return Response(
                {"detail": f"Invalid permission IDs: {sorted(invalid_ids)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Atomic replace
        RolePermission.objects.filter(role=role).delete()
        RolePermission.objects.bulk_create(
            [RolePermission(role=role, permission_id=pid) for pid in permission_ids]
        )

        role.refresh_from_db()
        return Response(PermissionSerializer(role.permissions.all(), many=True).data)
