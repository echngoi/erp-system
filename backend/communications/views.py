from django.db import transaction
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from communications.models import (
	CustomGroup,
	Message,
	MessageAttachment,
	MessageRecipient,
	MessageTarget,
)
from communications.serializers import MessageSerializer
from communications.serializers import CustomGroupLookupSerializer
from departments.models import Department
from notifications.models import Notification
from notifications.services import create_notifications
from users.models import User


class CustomGroupViewSet(viewsets.ReadOnlyModelViewSet):
	serializer_class = CustomGroupLookupSerializer
	permission_classes = [IsAuthenticated]

	def get_queryset(self):
		return CustomGroup.objects.order_by("name")


class MessageViewSet(viewsets.ModelViewSet):
	serializer_class = MessageSerializer
	permission_classes = [IsAuthenticated]
	max_attachment_size_bytes = 10 * 1024 * 1024

	def get_queryset(self):
		return (
			Message.objects.select_related("sender", "related_request", "parent")
			.prefetch_related("recipients", "targets", "attachments", "replies")
			.order_by("-created_at")
		)

	@action(detail=False, methods=["post"])
	def send(self, request):
		targets = request.data.get("targets", [])
		attachments = request.data.get("attachments", [])

		if not targets:
			raise ValidationError({"detail": "targets is required."})

		payload = {
			"subject": request.data.get("subject"),
			"content": request.data.get("content"),
			"is_important": request.data.get("is_important", False),
			"related_request": request.data.get("related_request"),
			"parent": request.data.get("parent"),
		}

		serializer = self.get_serializer(data=payload)
		serializer.is_valid(raise_exception=True)

		with transaction.atomic():
			message = serializer.save(sender=request.user)
			self._create_targets_and_recipients(message, targets)
			self._create_attachments(message, attachments)
			self._notify_message_created(message)

		return Response(self.get_serializer(message).data, status=status.HTTP_201_CREATED)

	@action(detail=False, methods=["get"])
	def inbox(self, request):
		unread_only = request.query_params.get("unread")
		important_only = request.query_params.get("important")
		queryset = self.get_queryset().inbox_for_user(request.user)

		if unread_only and unread_only.lower() in ["1", "true", "yes"]:
			queryset = queryset.filter(recipients__user=request.user, recipients__is_read=False)

		if important_only and important_only.lower() in ["1", "true", "yes"]:
			queryset = queryset.filter(recipients__user=request.user, recipients__is_important=True)

		page = self.paginate_queryset(queryset)
		if page is not None:
			serializer = self.get_serializer(page, many=True)
			return self.get_paginated_response(serializer.data)

		serializer = self.get_serializer(queryset, many=True)
		return Response(serializer.data, status=status.HTTP_200_OK)

	@action(detail=True, methods=["post"])
	def mark_read(self, request, pk=None):
		message = self.get_object()
		recipient = message.recipients.filter(user=request.user).first()
		if not recipient:
			return Response({"detail": "Message is not addressed to current user."}, status=status.HTTP_403_FORBIDDEN)

		recipient.mark_as_read()
		return Response(self.get_serializer(message).data, status=status.HTTP_200_OK)

	@action(detail=True, methods=["post"])
	def mark_important(self, request, pk=None):
		message = self.get_object()
		recipient = message.recipients.filter(user=request.user).first()
		if not recipient:
			if message.sender_id != request.user.id:
				return Response({"detail": "Message is not accessible to current user."}, status=status.HTTP_403_FORBIDDEN)

			now = timezone.now()
			recipient = MessageRecipient.objects.create(
				message=message,
				user=request.user,
				type=MessageRecipient.RecipientType.TO,
				is_read=True,
				read_at=now,
			)

		value = request.data.get("is_important")
		if value is None:
			recipient.is_important = not recipient.is_important
		elif isinstance(value, str):
			normalized = value.strip().lower()
			if normalized in {"1", "true", "yes"}:
				recipient.is_important = True
			elif normalized in {"0", "false", "no"}:
				recipient.is_important = False
			else:
				raise ValidationError({"is_important": "Invalid boolean value."})
		else:
			recipient.is_important = bool(value)

		recipient.save(update_fields=["is_important", "updated_at"])
		return Response(self.get_serializer(message).data, status=status.HTTP_200_OK)

	@action(detail=True, methods=["post"])
	def reply(self, request, pk=None):
		parent_message = self.get_object()
		payload = {
			"subject": request.data.get("subject") or f"Re: {parent_message.subject}",
			"content": request.data.get("content", "").strip(),
			"is_important": request.data.get("is_important", parent_message.is_important),
			"related_request": request.data.get("related_request", parent_message.related_request_id),
			"parent": parent_message.id,
		}

		if not payload["content"]:
			raise ValidationError({"content": "content is required."})

		serializer = self.get_serializer(data=payload)
		serializer.is_valid(raise_exception=True)

		targets = request.data.get("targets")
		attachments = request.data.get("attachments", [])

		with transaction.atomic():
			reply_message = serializer.save(sender=request.user)

			if targets:
				self._create_targets_and_recipients(reply_message, targets)
			else:
				self._reply_to_existing_participants(parent_message, reply_message, request.user)

			self._create_attachments(reply_message, attachments)
			self._notify_message_created(reply_message)

		return Response(self.get_serializer(reply_message).data, status=status.HTTP_201_CREATED)

	def _create_targets_and_recipients(self, message, targets):
		recipient_map = {}

		for target in targets:
			target_type = target.get("target_type")
			target_id = target.get("target_id")
			recipient_type = target.get("type", MessageRecipient.RecipientType.TO)

			if not target_type or not target_id:
				raise ValidationError({"detail": "Each target must include target_type and target_id."})

			MessageTarget.objects.create(
				message=message,
				target_type=target_type,
				target_id=target_id,
			)

			user_ids = self._resolve_target_user_ids(target_type, target_id)
			for user_id in user_ids:
				# Keep one recipient record per user while preserving first recipient type.
				recipient_map.setdefault(user_id, recipient_type)

		recipients = [
			MessageRecipient(
				message=message,
				user_id=user_id,
				type=recipient_type,
			)
			for user_id, recipient_type in recipient_map.items()
		]

		if not recipients:
			raise ValidationError({"detail": "Resolved recipient list is empty."})

		MessageRecipient.objects.bulk_create(recipients)

	def _resolve_target_user_ids(self, target_type, target_id):
		try:
			normalized_target_id = int(target_id)
		except (TypeError, ValueError):
			raise ValidationError({"detail": f"Invalid target_id '{target_id}'."})

		if target_type == MessageTarget.TargetType.USER:
			user = User.objects.filter(pk=normalized_target_id, is_active=True).first()
			if not user:
				raise ValidationError({"detail": f"User {normalized_target_id} not found."})
			return [user.id]

		if target_type == MessageTarget.TargetType.DEPARTMENT:
			department = Department.objects.filter(pk=normalized_target_id).first()
			if not department:
				raise ValidationError({"detail": f"Department {normalized_target_id} not found."})

			# Source of truth is User.department (FK), not Department.members M2M.
			member_ids = list(
				User.objects.filter(department_id=normalized_target_id, is_active=True)
				.values_list("id", flat=True)
			)
			if not member_ids:
				raise ValidationError({"detail": f"Department {normalized_target_id} has no active users."})
			return member_ids

		if target_type == MessageTarget.TargetType.GROUP:
			group = CustomGroup.objects.prefetch_related("members").filter(pk=normalized_target_id).first()
			if not group:
				raise ValidationError({"detail": f"Group {normalized_target_id} not found."})

			member_ids = list(group.members.filter(user__is_active=True).values_list("user_id", flat=True))
			return member_ids

		raise ValidationError({"detail": f"Unsupported target_type '{target_type}'."})

	def _create_attachments(self, message, attachments):
		if not attachments:
			return

		rows = []
		for item in attachments:
			file_name = ""
			file_size = None
			mime_type = ""
			if isinstance(item, dict):
				file_url = item.get("file_url")
				file_name = (item.get("file_name") or "").strip()
				mime_type = (item.get("mime_type") or "").strip()
				if item.get("file_size") is not None:
					try:
						file_size = int(item.get("file_size"))
					except (TypeError, ValueError):
						raise ValidationError({"detail": "Invalid attachment file_size."})
			else:
				file_url = item

			if not file_url:
				continue

			if file_size is not None:
				if file_size <= 0:
					raise ValidationError({"detail": "Attachment file_size must be greater than 0."})
				if file_size > self.max_attachment_size_bytes:
					raise ValidationError({"detail": "Attachment exceeds maximum size of 10MB."})

			rows.append(
				MessageAttachment(
					message=message,
					file_url=file_url,
					file_name=file_name,
					file_size=file_size,
					mime_type=mime_type,
				)
			)

		if rows:
			MessageAttachment.objects.bulk_create(rows)

	def _reply_to_existing_participants(self, parent_message, reply_message, sender):
		participant_ids = set(
			parent_message.recipients.values_list("user_id", flat=True)
		)
		participant_ids.add(parent_message.sender_id)
		participant_ids.discard(sender.id)

		recipients = [
			MessageRecipient(
				message=reply_message,
				user_id=user_id,
				type=MessageRecipient.RecipientType.TO,
			)
			for user_id in participant_ids
		]

		if recipients:
			MessageRecipient.objects.bulk_create(recipients)

	def _notify_message_created(self, message):
		recipient_ids = message.recipients.values_list("user_id", flat=True)
		content = f"New message: {message.subject}"
		create_notifications(
			user_ids=recipient_ids,
			content=content,
			notification_type=Notification.NotificationType.MESSAGE,
			exclude_user_id=message.sender_id,
		)
