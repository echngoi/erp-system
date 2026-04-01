from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from approvals.services import initialize_first_workflow_step
from approvals.models import RequestApproval
from approvals.models import Workflow
from departments.models import Department
from notifications.models import Notification
from notifications.services import create_notifications
from requestsystem.models import Request, RequestAssignment, RequestAttachment, RequestLog, RequestQuickTitle
from requestsystem.serializers import RequestAttachmentSerializer, RequestQuickTitleSerializer, RequestSerializer
from users.models import User


class RequestViewSet(viewsets.ModelViewSet):
	serializer_class = RequestSerializer
	permission_classes = [IsAuthenticated]
	parser_classes = [JSONParser, FormParser, MultiPartParser]
	# Keep this configurable at class level to avoid hardcoded status in business logic.
	auto_close_status = RequestAssignment.Status.CLOSED

	def get_queryset(self):
		user = self.request.user
		queryset = (
			Request.objects.select_related("created_by", "workflow", "parent_request")
			.prefetch_related("assignments", "logs", "ratings", "approvals", "attachments")
			.order_by("-created_at")
		)

		# Visibility rule: users can see requests they created, are assigned to, or are approval actors.
		queryset = queryset.filter(
			Q(created_by=user) | Q(assignments__user=user) | Q(approvals__approver=user)
		).distinct()

		status_value = self.request.query_params.get("status")
		request_type = self.request.query_params.get("type")
		category_value = self.request.query_params.get("category")
		created_today_value = (self.request.query_params.get("created_today") or "").strip().lower()
		search_query = (self.request.query_params.get("q") or "").strip()
		needs_my_approval_value = (self.request.query_params.get("needs_my_approval") or "").strip().lower()

		if needs_my_approval_value in {"1", "true", "yes"}:
			queryset = queryset.filter(
				status=Request.Status.PENDING_APPROVAL,
				approvals__approver=user,
				approvals__status=RequestApproval.Status.PENDING,
				approvals__step__step_order=F("current_step"),
			).distinct()

		if status_value:
			queryset = queryset.filter(status=status_value)
		if request_type:
			queryset = queryset.filter(type=request_type)
		if category_value:
			queryset = queryset.filter(category=category_value)
		if created_today_value in {"1", "true", "yes"}:
			queryset = queryset.filter(created_at__date=timezone.localdate())
		if search_query:
			queryset = queryset.filter(
				Q(title__icontains=search_query)
				| Q(created_by__username__icontains=search_query)
				| Q(created_by__full_name__icontains=search_query)
				| Q(created_by__email__icontains=search_query)
				| Q(assignments__user__username__icontains=search_query)
				| Q(assignments__user__full_name__icontains=search_query)
				| Q(assignments__user__email__icontains=search_query)
			).distinct()

		return queryset

	def update(self, request, *args, **kwargs):
		req = self.get_object()
		self._ensure_sender_can_modify(req, request.user)
		return super().update(request, *args, **kwargs)

	def partial_update(self, request, *args, **kwargs):
		req = self.get_object()
		self._ensure_sender_can_modify(req, request.user)
		return super().partial_update(request, *args, **kwargs)

	def destroy(self, request, *args, **kwargs):
		req = self.get_object()
		self._ensure_sender_can_modify(req, request.user)
		return super().destroy(request, *args, **kwargs)

	def perform_create(self, serializer):
		target_ids = serializer.validated_data.get("target_ids")
		with transaction.atomic():
			req = serializer.save(created_by=self.request.user)

			# Approval requests start from workflow step 1 automatically.
			if req.type == Request.RequestType.APPROVAL:
				# Auto-assign workflow by category when not explicitly provided.
				if not req.workflow_id and req.category:
					matched = Workflow.objects.filter(type=req.category).order_by("-updated_at", "-id").first()
					if matched:
						req.workflow = matched
						req.save(update_fields=["workflow", "updated_at"])

				if not req.workflow_id:
					raise ValidationError({"workflow": "No workflow found for selected approval category."})

				initialize_first_workflow_step(req)
				self._create_log(req, self.request.user, "APPROVAL_STARTED", "Approval workflow initialized")
			else:
				try:
					self._assign_request(req, req.target_type, req.target_id, target_ids=target_ids)
				except ValueError as exc:
					raise ValidationError({"detail": str(exc)})
			self._create_log(req, self.request.user, "REQUEST_CREATED", "Request created")
			self._notify_request_created(req)

	@action(detail=True, methods=["post"])
	def start_approval(self, request, pk=None):
		req = self.get_object()
		with transaction.atomic():
			initialize_first_workflow_step(req)
			self._create_log(req, request.user, "APPROVAL_STARTED", "Approval workflow initialized manually")
			self._notify_request_created(req)

		return Response(self.get_serializer(req).data, status=status.HTTP_200_OK)

	@action(detail=True, methods=["post"])
	def assign(self, request, pk=None):
		req = self.get_object()
		target_type = request.data.get("target_type", req.target_type)
		target_id = request.data.get("target_id", req.target_id)
		target_ids = request.data.get("target_ids")

		if not target_type or (not target_id and not target_ids):
			return Response(
				{"detail": "target_type and target_id or target_ids are required."},
				status=status.HTTP_400_BAD_REQUEST,
			)

		normalized_target_ids = None
		if target_ids is not None:
			if not isinstance(target_ids, list) or not target_ids:
				return Response({"detail": "target_ids must be a non-empty list."}, status=status.HTTP_400_BAD_REQUEST)
			try:
				normalized_target_ids = list(dict.fromkeys(int(value) for value in target_ids))
			except (TypeError, ValueError):
				return Response({"detail": "target_ids must contain valid integers."}, status=status.HTTP_400_BAD_REQUEST)
			target_id = normalized_target_ids[0]
		else:
			try:
				target_id = int(target_id)
			except (TypeError, ValueError):
				return Response({"detail": "target_id must be an integer."}, status=status.HTTP_400_BAD_REQUEST)

		with transaction.atomic():
			req.target_type = target_type
			req.target_id = target_id
			req.status = Request.Status.PENDING
			req.save(update_fields=["target_type", "target_id", "status", "updated_at"])

			req.assignments.all().delete()
			try:
				self._assign_request(req, target_type, target_id, target_ids=normalized_target_ids)
			except ValueError as exc:
				raise ValidationError({"detail": str(exc)})
			self._create_log(req, request.user, "REQUEST_ASSIGNED", f"Assigned to {target_type}:{target_id}")

		return Response(self.get_serializer(req).data, status=status.HTTP_200_OK)

	@action(detail=True, methods=["post"])
	def accept(self, request, pk=None):
		req = self.get_object()
		assignment = self._get_user_assignment(req, request.user)
		if assignment is None:
			return Response({"detail": "No assignment found for current user."}, status=status.HTTP_403_FORBIDDEN)

		if assignment.status != RequestAssignment.Status.PENDING:
			return Response({"detail": "Only pending assignment can be accepted."}, status=status.HTTP_400_BAD_REQUEST)

		with transaction.atomic():
			assignment.status = RequestAssignment.Status.ACCEPTED
			now = timezone.now()
			assignment.action_at = now
			assignment.save(update_fields=["status", "action_at", "updated_at"])

			# Department assignment creates many assignees. Once one accepts,
			# all other pending assignees are auto-closed so ownership is unique.
			self._auto_close_other_assignments(req, accepted_assignment=assignment, action_time=now)
			req.status = Request.Status.IN_PROGRESS
			req.save(update_fields=["status", "updated_at"])

			self._create_log(req, request.user, "REQUEST_ACCEPTED", "Request accepted")

		return Response(self.get_serializer(req).data, status=status.HTTP_200_OK)

	@action(detail=True, methods=["post"])
	def reject(self, request, pk=None):
		req = self.get_object()
		assignment = self._get_user_assignment(req, request.user)
		if assignment is None:
			return Response({"detail": "No assignment found for current user."}, status=status.HTTP_403_FORBIDDEN)

		if assignment.status != RequestAssignment.Status.PENDING:
			return Response({"detail": "Only pending assignment can be rejected."}, status=status.HTTP_400_BAD_REQUEST)

		reason = request.data.get("reason", "").strip() if request.data else ""

		with transaction.atomic():
			assignment.status = RequestAssignment.Status.REJECTED
			assignment.action_at = timezone.now()
			assignment.save(update_fields=["status", "action_at", "updated_at"])

			if reason:
				req.notes = reason
				req.save(update_fields=["notes", "updated_at"])

			remaining_pending = req.assignments.filter(status=RequestAssignment.Status.PENDING).exists()
			if not remaining_pending:
				req.status = Request.Status.REJECTED
				req.save(update_fields=["status", "updated_at"])

			self._create_log(req, request.user, "REQUEST_REJECTED", f"Request rejected{f': {reason}' if reason else ''}")

		return Response(self.get_serializer(req).data, status=status.HTTP_200_OK)

	@action(detail=True, methods=["post"])
	def mark_done(self, request, pk=None):
		return self._mark_completion(request, Request.Status.DONE, RequestAssignment.Status.DONE, "REQUEST_DONE", None)

	@action(detail=True, methods=["post"])
	def mark_failed(self, request, pk=None):
		reason = request.data.get("reason", "").strip() if request.data else ""
		return self._mark_completion(
			request,
			Request.Status.FAILED,
			RequestAssignment.Status.REJECTED,
			"REQUEST_FAILED",
			reason,
		)

	@action(detail=True, methods=["get", "post"], url_path="attachments")
	def attachments(self, request, pk=None):
		req = self.get_object()

		if request.method.lower() == "get":
			queryset = req.attachments.order_by("-created_at")
			data = RequestAttachmentSerializer(queryset, many=True, context={"request": request}).data
			return Response(data, status=status.HTTP_200_OK)

		if req.created_by_id != request.user.id:
			raise PermissionDenied("Only request sender can upload attachments.")

		files = request.FILES.getlist("files")
		if not files and request.FILES.get("file"):
			files = [request.FILES.get("file")]

		if not files:
			return Response({"detail": "No attachment files uploaded."}, status=status.HTTP_400_BAD_REQUEST)

		created_rows = [
			RequestAttachment.objects.create(
				request=req,
				uploaded_by=request.user,
				file=file_obj,
				file_name=getattr(file_obj, "name", "") or "",
				file_size=getattr(file_obj, "size", None),
				mime_type=getattr(file_obj, "content_type", "") or "",
			)
			for file_obj in files
		]
		data = RequestAttachmentSerializer(created_rows, many=True, context={"request": request}).data
		return Response(data, status=status.HTTP_201_CREATED)

	def _mark_completion(self, request, req_status, assignment_status, action_name, reason=None):
		req = self.get_object()
		assignment = self._get_user_assignment(req, request.user)
		if assignment is None:
			return Response({"detail": "No assignment found for current user."}, status=status.HTTP_403_FORBIDDEN)

		if req.status not in [Request.Status.ACCEPTED, Request.Status.IN_PROGRESS]:
			return Response(
				{"detail": "Request must be accepted or in progress before completion."},
				status=status.HTTP_400_BAD_REQUEST,
			)

		with transaction.atomic():
			assignment.status = assignment_status
			assignment.action_at = timezone.now()
			assignment.save(update_fields=["status", "action_at", "updated_at"])

			req.status = req_status
			if reason:
				req.notes = reason
			req.save(update_fields=["status"] + (["notes"] if reason else []) + ["updated_at"])
			self._create_log(req, request.user, action_name, action_name.replace("_", " ").title() + (f": {reason}" if reason else ""))

		return Response(self.get_serializer(req).data, status=status.HTTP_200_OK)

	def _assign_request(self, req, target_type, target_id, target_ids=None):
		if target_type == Request.TargetType.USER:
			resolved_user_ids = target_ids or [target_id]
			self._assign_to_user(req, resolved_user_ids)
			req.status = Request.Status.PENDING
			req.save(update_fields=["status", "updated_at"])
			return

		if target_type == Request.TargetType.DEPARTMENT:
			self._assign_to_department(req, target_id)
			req.status = Request.Status.PENDING
			req.save(update_fields=["status", "updated_at"])
			return

		raise ValueError("Invalid target_type")

	def _assign_to_user(self, req, user_ids):
		if not isinstance(user_ids, list):
			user_ids = [user_ids]

		creator_id = req.created_by_id
		resolved_ids = [uid for uid in dict.fromkeys(int(uid) for uid in user_ids) if uid != creator_id]
		if not resolved_ids:
			raise ValueError("Không thể gửi yêu cầu chỉ cho chính mình")

		users = list(User.objects.filter(pk__in=resolved_ids, is_active=True))
		if len(users) != len(resolved_ids):
			raise ValueError("One or more target users were not found or inactive")

		RequestAssignment.objects.bulk_create(
			[
				RequestAssignment(request=req, user=user, status=RequestAssignment.Status.PENDING)
				for user in users
			]
		)


	def _assign_to_department(self, req, department_id):
		department = Department.objects.filter(pk=department_id).first()
		if not department:
			raise ValueError("Target department not found")

		members = list(
			User.objects.filter(department_id=department_id, is_active=True)
			.exclude(pk=req.created_by_id)
		)
		if not members:
			raise ValueError("Department has no other members to assign")

		# One assignment per department member so each person can explicitly accept/reject.
		RequestAssignment.objects.bulk_create(
			[
				RequestAssignment(
					request=req,
					user=member,
					status=RequestAssignment.Status.PENDING,
				)
				for member in members
			]
		)

	def _get_user_assignment(self, req, user):
		return req.assignments.filter(user=user).first()

	def _auto_close_other_assignments(self, req, accepted_assignment, action_time):
		req.assignments.exclude(pk=accepted_assignment.pk).filter(
			status=RequestAssignment.Status.PENDING
		).update(
			status=self.auto_close_status,
			action_at=action_time,
		)

	def _create_log(self, req, user, action, note):
		RequestLog.objects.create(request=req, user=user, action=action, note=note)

	def _ensure_sender_can_modify(self, req, user):
		if req.created_by_id != user.id:
			raise PermissionDenied("Only the request sender can edit or delete this request.")

		if req.type == Request.RequestType.APPROVAL:
			has_approval_decision = req.approvals.exclude(status=RequestApproval.Status.PENDING).exists()
			if has_approval_decision:
				raise PermissionDenied("Cannot edit/delete request after any approver has acted.")
			return

		has_any_response = req.assignments.exclude(status=RequestAssignment.Status.PENDING).exists()
		if has_any_response:
			raise PermissionDenied("Cannot edit/delete request after recipients have responded.")

	def _notify_request_created(self, req):
		if req.type == Request.RequestType.APPROVAL:
			target_user_ids = req.approvals.filter(
				status=RequestApproval.Status.PENDING
			).values_list("approver_id", flat=True)
			notice = f"New approval request: {req.title}"
		else:
			target_user_ids = req.assignments.values_list("user_id", flat=True)
			notice = f"New task request: {req.title}"

		create_notifications(
			user_ids=target_user_ids,
			content=notice,
			notification_type=Notification.NotificationType.REQUEST,
			exclude_user_id=req.created_by_id,
		)


class RequestQuickTitleViewSet(viewsets.ModelViewSet):
	"""ViewSet for admin-managed quick request titles."""

	serializer_class = RequestQuickTitleSerializer
	permission_classes = [IsAuthenticated]

	def get_queryset(self):
		# Non-admins only see active titles.
		user = self.request.user
		qs = RequestQuickTitle.objects.all()
		if not (user.is_staff or user.is_superuser or (hasattr(user, "roles") and "admin" in (user.roles or []))):
			qs = qs.filter(is_active=True)
		return qs

	def _check_admin(self):
		user = self.request.user
		is_admin = user.is_staff or user.is_superuser or (hasattr(user, "roles") and "admin" in (user.roles or []))
		if not is_admin:
			raise PermissionDenied("Only admins can manage quick titles.")

	def create(self, request, *args, **kwargs):
		self._check_admin()
		return super().create(request, *args, **kwargs)

	def update(self, request, *args, **kwargs):
		self._check_admin()
		return super().update(request, *args, **kwargs)

	def partial_update(self, request, *args, **kwargs):
		self._check_admin()
		return super().partial_update(request, *args, **kwargs)

	def destroy(self, request, *args, **kwargs):
		self._check_admin()
		return super().destroy(request, *args, **kwargs)
