from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from departments.models import Department
from departments.serializers import DepartmentLookupSerializer, DepartmentSerializer
from rbac.utils import user_has_role
from users.models import User
from users.permissions import IsAdminOrManager
from users.serializers import UserSerializer


class DepartmentViewSet(viewsets.ModelViewSet):
    serializer_class = DepartmentSerializer
    permission_classes = [IsAdminOrManager]

    def get_queryset(self):
        return Department.objects.select_related("parent", "manager").order_by("name")

    def destroy(self, request, *args, **kwargs):
        """Prevent hard-delete; only ADMIN may delete."""
        if not user_has_role(request.user, "admin"):
            return Response(
                {"detail": "Only administrators can delete departments."},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=False, methods=["get"], url_path="lookup", permission_classes=[IsAuthenticated])
    def lookup(self, request):
        queryset = self.get_queryset()
        serializer = DepartmentLookupSerializer(queryset, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=["get"], url_path="users")
    def users(self, request, pk=None):
        """GET /departments/:id/users/ — list active users in this department."""
        department = self.get_object()
        members = User.objects.filter(
            department=department, is_active=True
        ).select_related("department").order_by("username")
        serializer = UserSerializer(members, many=True)
        return Response(serializer.data)
