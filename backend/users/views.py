from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from rbac.utils import get_user_permissions
from users.models import User
from users.permissions import IsAdmin
from users.serializers import UserLookupSerializer, UserSerializer


class UserViewSet(viewsets.ModelViewSet):
    serializer_class = UserSerializer
    permission_classes = [IsAdmin]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["department"]

    def get_queryset(self):
        queryset = User.objects.select_related("department").prefetch_related("user_roles__role").order_by("username")
        role_id = self.request.query_params.get("role_id")
        if role_id:
            queryset = queryset.filter(user_roles__role_id=role_id)
        
        search_query = self.request.query_params.get("q", "").strip()
        if search_query:
            from django.db.models import Q
            queryset = queryset.filter(
                Q(username__icontains=search_query)
                | Q(full_name__icontains=search_query)
                | Q(email__icontains=search_query)
            )
        
        return queryset.distinct()

    def destroy(self, request, *args, **kwargs):
        """Soft-delete: set is_active=False instead of removing the record."""
        user = self.get_object()
        user.is_active = False
        user.save(update_fields=["is_active"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @action(detail=False, methods=["get"], url_path="lookup", permission_classes=[IsAuthenticated])
    def lookup(self, request):
        queryset = self.get_queryset().filter(is_active=True)
        serializer = UserLookupSerializer(queryset, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=["get"], url_path="check-username", permission_classes=[IsAdmin])
    def check_username(self, request):
        """GET /users/check-username/?username=xxx — check if username exists."""
        username = request.query_params.get("username", "").strip()
        if not username:
            return Response({"exists": False})

        exclude_user_id = request.query_params.get("exclude_id")
        queryset = User.objects.filter(username__iexact=username)
        if exclude_user_id:
            queryset = queryset.exclude(pk=exclude_user_id)

        exists = queryset.exists()
        return Response({"exists": exists})

    @action(detail=True, methods=["get"], url_path="permissions")
    def list_permissions(self, request, pk=None):
        """GET /users/:id/permissions/ — list all permission codes for this user."""
        user = self.get_object()
        return Response({"permissions": get_user_permissions(user)})
