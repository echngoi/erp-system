from rest_framework.pagination import PageNumberPagination
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from notifications.models import Notification
from notifications.serializers import NotificationSerializer


class NotificationPagination(PageNumberPagination):
	page_size = 8
	page_size_query_param = "page_size"
	max_page_size = 50


class NotificationViewSet(viewsets.ReadOnlyModelViewSet):
	serializer_class = NotificationSerializer
	permission_classes = [IsAuthenticated]
	pagination_class = NotificationPagination

	def get_queryset(self):
		queryset = Notification.objects.filter(user=self.request.user)
		unread_only = (self.request.query_params.get("unread") or "").strip().lower()
		if unread_only in {"1", "true", "yes"}:
			queryset = queryset.filter(is_read=False)
		return queryset.order_by("is_read", "-created_at")

	@action(detail=True, methods=["post"])
	def mark_read(self, request, pk=None):
		notification = self.get_object()
		notification.mark_as_read()
		return Response(self.get_serializer(notification).data, status=status.HTTP_200_OK)

	@action(detail=False, methods=["post"])
	def mark_all_read(self, request):
		updated_count = self.get_queryset().filter(is_read=False).update(is_read=True)
		return Response(
			{
				"detail": "Notifications marked as read.",
				"updated_count": updated_count,
			},
			status=status.HTTP_200_OK,
		)
