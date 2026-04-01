import re

from django.db import transaction
from django.db.models import Q
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from approvals.models import ApprovalTemplate, RequestApproval, Workflow, WorkflowStep
from approvals.services import activate_step_for_request, complete_workflow_instance, reject_workflow_instance
from approvals.serializers import (
	ApprovalTemplateSerializer,
	RequestApprovalSerializer,
	WorkflowInstanceSerializer,
	WorkflowSerializer,
	WorkflowStepsReplaceSerializer,
	WorkflowStepWriteSerializer,
	WorkflowWriteSerializer,
)
from notifications.models import Notification
from notifications.services import create_notifications
from rbac.utils import user_has_role
from requestsystem.models import Request, RequestLog
from users.permissions import IsAdminOrManager


APPROVAL_TEMPLATE_DEFINITIONS = {
	"LEAVE": {
		"label": "Nghỉ phép",
		"description": "Yêu cầu nghỉ phép có số ngày, loại nghỉ và lý do.",
		"fields": [
			{
				"name": "leave_type",
				"label": "Loại nghỉ",
				"input": "select",
				"required": True,
				"options": [
					{"label": "Nghỉ phép năm", "value": "annual"},
					{"label": "Nghỉ ốm", "value": "sick"},
					{"label": "Nghỉ không lương", "value": "unpaid"},
				],
			},
			{"name": "from_date", "label": "Từ ngày", "input": "date", "required": True},
			{"name": "to_date", "label": "Đến ngày", "input": "date", "required": True},
			{"name": "days", "label": "Số ngày nghỉ", "input": "number", "required": True},
			{"name": "reason", "label": "Lý do", "input": "textarea", "required": True},
		],
	},
	"PURCHASE": {
		"label": "Mua sắm",
		"description": "Đề xuất mua sắm có ngân sách và nhà cung cấp dự kiến.",
		"fields": [
			{"name": "item_name", "label": "Hạng mục mua", "input": "text", "required": True},
			{"name": "quantity", "label": "Số lượng", "input": "number", "required": True},
			{"name": "estimated_cost", "label": "Chi phí ước tính", "input": "number", "required": True},
			{"name": "vendor", "label": "Nhà cung cấp dự kiến", "input": "text", "required": False},
			{"name": "business_reason", "label": "Mục đích sử dụng", "input": "textarea", "required": True},
		],
	},
	"DOCUMENT": {
		"label": "Chứng từ",
		"description": "Trình ký chứng từ hoặc hồ sơ nội bộ.",
		"fields": [
			{"name": "document_type", "label": "Loại chứng từ", "input": "text", "required": True},
			{"name": "document_no", "label": "Số chứng từ", "input": "text", "required": False},
			{"name": "issued_date", "label": "Ngày chứng từ", "input": "date", "required": False},
			{"name": "summary", "label": "Tóm tắt nội dung", "input": "textarea", "required": True},
		],
	},
}


class RequestApprovalViewSet(viewsets.ModelViewSet):
	serializer_class = RequestApprovalSerializer
	permission_classes = [IsAuthenticated]

	def get_queryset(self):
		queryset = (
			RequestApproval.objects.select_related("request", "step", "approver")
			.filter(request__type=Request.RequestType.APPROVAL)
			.order_by("request_id", "step__step_order", "id")
		)

		# Privacy rule: each user can see only approval rows assigned to themselves.
		queryset = queryset.filter(approver=self.request.user)

		status_value = self.request.query_params.get("status")
		search_query = (self.request.query_params.get("q") or "").strip()

		if status_value:
			queryset = queryset.filter(status=status_value)

		if search_query:
			queryset = queryset.filter(
				Q(request__title__icontains=search_query)
				| Q(request__created_by__username__icontains=search_query)
				| Q(request__created_by__full_name__icontains=search_query)
				| Q(request__created_by__email__icontains=search_query)
				| Q(approver__username__icontains=search_query)
				| Q(approver__full_name__icontains=search_query)
				| Q(approver__email__icontains=search_query)
			).distinct()

		return queryset

	@action(detail=False, methods=["get"], url_path="templates")
	def templates(self, request):
		templates = ApprovalTemplate.objects.filter(is_active=True).select_related("workflow").prefetch_related(
			"workflow__steps"
		).order_by("type", "name")
		
		# Group by type for frontend
		grouped = {}
		for template in templates:
			template_type = template.type
			if template_type not in grouped:
				grouped[template_type] = {
					"type": template_type,
					"templates": [],
				}
			
			grouped[template_type]["templates"].append({
				"id": template.id,
				"name": template.name,
				"description": template.description,
				"schema": template.schema,
				"workflow": {
					"id": template.workflow.id,
					"name": template.workflow.name,
					"description": template.workflow.description,
					"steps_count": template.workflow.steps.count(),
				},
			})
		
		return Response(list(grouped.values()))

	@action(detail=True, methods=["post"])
	def approve(self, request, pk=None):
		with transaction.atomic():
			approval = self._get_locked_approval(pk)
			self._validate_can_act(approval, request.user)
			self._ensure_previous_steps_approved(approval)

			approval.status = RequestApproval.Status.APPROVED
			approval.note = request.data.get("note", approval.note)
			approval.save(update_fields=["status", "note", "updated_at"])

			req = approval.request
			if self._has_pending_in_current_step(req):
				self._log(req, request.user, "APPROVAL_APPROVED", "Current approver approved")
				self._notify_request_owner(
					req,
					f"Your approval request '{req.title}' has a new approval action.",
				)
				return Response(self.get_serializer(approval).data, status=status.HTTP_200_OK)

			next_step = self._get_next_step(req)
			if not next_step:
				req.status = Request.Status.APPROVED
				req.save(update_fields=["status", "updated_at"])
				complete_workflow_instance(req)
				self._log(req, request.user, "APPROVAL_COMPLETED", "Workflow fully approved")
				self._notify_request_owner(req, f"Your request '{req.title}' has been approved.")
				return Response(self.get_serializer(approval).data, status=status.HTTP_200_OK)

			self._activate_next_step(req, next_step)
			self._log(
				req,
				request.user,
				"APPROVAL_STEP_ADVANCED",
				f"Moved to workflow step {next_step.step_order}",
			)
			self._notify_next_step_approvers(req, next_step)
			self._notify_request_owner(
				req,
				f"Your approval request '{req.title}' moved to step {next_step.step_order}.",
			)

		return Response(self.get_serializer(approval).data, status=status.HTTP_200_OK)

	@action(detail=True, methods=["post"])
	def reject(self, request, pk=None):
		note = request.data.get("note")
		if not note:
			return Response({"detail": "note is required when rejecting."}, status=status.HTTP_400_BAD_REQUEST)

		with transaction.atomic():
			approval = self._get_locked_approval(pk)
			self._validate_can_act(approval, request.user)
			self._ensure_previous_steps_approved(approval)

			approval.status = RequestApproval.Status.REJECTED
			approval.note = note
			approval.save(update_fields=["status", "note", "updated_at"])

			req = approval.request
			# Any rejection is terminal for the whole workflow.
			req.status = Request.Status.REJECTED
			req.save(update_fields=["status", "updated_at"])

			# Stop all remaining pending approvals to keep workflow state consistent.
			RequestApproval.objects.filter(
				request=req,
				status=RequestApproval.Status.PENDING,
			).exclude(pk=approval.pk).update(
				status=RequestApproval.Status.REJECTED,
				note="Auto-rejected because another approver rejected.",
			)
			reject_workflow_instance(req)
			self._log(req, request.user, "APPROVAL_REJECTED", note)
			self._notify_request_owner(req, f"Your request '{req.title}' was rejected: {note}")

		return Response(self.get_serializer(approval).data, status=status.HTTP_200_OK)

	def _get_locked_approval(self, pk):
		return (
			RequestApproval.objects.select_related("request", "step", "approver")
			.select_for_update()
			.get(pk=pk)
		)

	def _validate_can_act(self, approval, acting_user):
		if approval.approver_id != acting_user.id:
			raise PermissionDenied("Only assigned approver can perform this action.")

		if approval.status != RequestApproval.Status.PENDING:
			raise ValidationError({"detail": "Only pending approval can be processed."})

		if approval.request.status in [Request.Status.REJECTED, Request.Status.APPROVED]:
			raise ValidationError({"detail": "Request is already finalized."})

		if approval.step.step_order != approval.request.current_step:
			raise ValidationError({"detail": "This approval is not in the current active step."})

	def _ensure_previous_steps_approved(self, approval):
		previous_exists = RequestApproval.objects.filter(
			request=approval.request,
			step__step_order__lt=approval.step.step_order,
		).exclude(status=RequestApproval.Status.APPROVED).exists()

		if previous_exists:
			raise ValidationError({"detail": "Previous workflow step is not fully approved."})

	def _has_pending_in_current_step(self, req):
		return RequestApproval.objects.filter(
			request=req,
			step__step_order=req.current_step,
			status=RequestApproval.Status.PENDING,
		).exists()

	def _get_next_step(self, req):
		return (
			WorkflowStep.objects.filter(workflow=req.workflow, step_order__gt=req.current_step)
			.order_by("step_order")
			.first()
		)

	def _activate_next_step(self, req, next_step):
		# Reuse shared service so initialization and progression follow one policy.
		activate_step_for_request(req, next_step)

	def _log(self, req, user, action, note):
		RequestLog.objects.create(request=req, user=user, action=action, note=note)

	def _notify_request_owner(self, req, content):
		create_notifications(
			user_ids=[req.created_by_id],
			content=content,
			notification_type=Notification.NotificationType.APPROVAL,
		)

	def _notify_next_step_approvers(self, req, step):
		approver_ids = req.approvals.filter(
			step=step,
			status=RequestApproval.Status.PENDING,
		).values_list("approver_id", flat=True)

		create_notifications(
			user_ids=approver_ids,
			content=f"Approval required for request: {req.title}",
			notification_type=Notification.NotificationType.APPROVAL,
		)


class WorkflowViewSet(viewsets.ModelViewSet):
	"""
	CRUD for Workflows.
	ADMIN can create/update/delete; ADMIN + MANAGER can list/retrieve.

	Extra endpoints:
	  GET  /workflows/?type=LEAVE          – filter by type
	  POST /workflows/:id/steps/           – add a step to a workflow
	  GET  /workflows/:id/instances/       – list all running instances of a workflow
	"""

	permission_classes = [IsAdminOrManager]

	def get_queryset(self):
		qs = Workflow.objects.prefetch_related("steps").order_by("name")
		workflow_type = self.request.query_params.get("type")
		if workflow_type:
			qs = qs.filter(type=workflow_type)
		return qs

	def get_serializer_class(self):
		if self.action in ("create", "update", "partial_update"):
			return WorkflowWriteSerializer
		return WorkflowSerializer

	def perform_create(self, serializer):
		if not user_has_role(self.request.user, "admin"):
			from rest_framework.exceptions import PermissionDenied
			raise PermissionDenied("Only administrators can create workflows.")
		serializer.save()

	def perform_update(self, serializer):
		if not user_has_role(self.request.user, "admin"):
			from rest_framework.exceptions import PermissionDenied
			raise PermissionDenied("Only administrators can update workflows.")
		serializer.save()

	def destroy(self, request, *args, **kwargs):
		if not user_has_role(request.user, "admin"):
			return Response(
				{"detail": "Only administrators can delete workflows."},
				status=status.HTTP_403_FORBIDDEN,
			)
		return super().destroy(request, *args, **kwargs)

	@action(detail=True, methods=["post"], url_path="steps")
	def add_step(self, request, pk=None):
		"""
		POST /workflows/:id/steps/
		Body: { "step_order": 1, "role_required": "manager" }
		Adds a new step to this workflow.
		"""
		if not user_has_role(request.user, "admin"):
			return Response(
				{"detail": "Only administrators can add workflow steps."},
				status=status.HTTP_403_FORBIDDEN,
			)
		workflow = self.get_object()
		serializer = WorkflowStepWriteSerializer(data=request.data)
		serializer.is_valid(raise_exception=True)
		step = serializer.save(workflow=workflow)
		return Response(WorkflowStepWriteSerializer(step).data, status=status.HTTP_201_CREATED)

	@action(detail=True, methods=["post"], url_path="replace-steps")
	def replace_steps(self, request, pk=None):
		"""
		POST /workflows/:id/replace-steps/
		Body:
		{
		  "name": "Optional name",
		  "description": "Optional description",
		  "steps": [
		    {"step_order": 1, "role_required": "manager"},
		    {"step_order": 2, "role_required": "admin"}
		  ]
		}

		Replaces steps. If workflow has history and structure changes, create a new version.
		"""
		if not user_has_role(request.user, "admin"):
			return Response(
				{"detail": "Only administrators can update workflow steps."},
				status=status.HTTP_403_FORBIDDEN,
			)

		workflow = self.get_object()

		# Safety guard: disallow structural edits while active instances exist.
		if workflow.instances.filter(status="ACTIVE").exists():
			return Response(
				{"detail": "Cannot modify steps while workflow has active instances."},
				status=status.HTTP_400_BAD_REQUEST,
			)

		serializer = WorkflowStepsReplaceSerializer(data=request.data)
		serializer.is_valid(raise_exception=True)
		validated = serializer.validated_data
		steps_data = sorted(validated["steps"], key=lambda item: item["step_order"])
		desired_step_orders = [item["step_order"] for item in steps_data]
		target_name = (validated.get("name") or workflow.name).strip()
		target_description = validated.get("description", workflow.description)

		version_created = False
		result_workflow = workflow

		with transaction.atomic():
			has_historical_approvals = RequestApproval.objects.filter(step__workflow=workflow).exists()
			existing_steps = list(workflow.steps.order_by("step_order"))
			existing_step_orders = [step.step_order for step in existing_steps]
			structure_changed = existing_step_orders != desired_step_orders

			if has_historical_approvals and structure_changed:
				new_name = self._build_versioned_workflow_name(target_name)
				result_workflow = Workflow.objects.create(
					name=new_name,
					type=workflow.type,
					description=target_description,
				)
				WorkflowStep.objects.bulk_create(
					[
						WorkflowStep(
							workflow=result_workflow,
							step_order=item["step_order"],
							role_required=item["role_required"],
							approver_scope=item.get("approver_scope", WorkflowStep.ApproverScope.ALL_WITH_ROLE),
							approver_department_id=item.get("approver_department"),
							approver_user_id=item.get("approver_user"),
						)
						for item in steps_data
					]
				)
				version_created = True
			else:
				workflow.name = target_name
				workflow.description = target_description
				workflow.save(update_fields=["name", "description", "updated_at"])

				if has_historical_approvals:
					desired_by_order = {item["step_order"]: item for item in steps_data}
					steps_to_update = []
					for step in existing_steps:
						item = desired_by_order.get(step.step_order)
						if not item:
							continue
						changed = False
						if item["role_required"] != step.role_required:
							step.role_required = item["role_required"]
							changed = True
						new_scope = item.get("approver_scope", WorkflowStep.ApproverScope.ALL_WITH_ROLE)
						if new_scope != step.approver_scope:
							step.approver_scope = new_scope
							changed = True
						new_dept = item.get("approver_department")
						if new_dept != step.approver_department_id:
							step.approver_department_id = new_dept
							changed = True
						new_user = item.get("approver_user")
						if new_user != step.approver_user_id:
							step.approver_user_id = new_user
							changed = True
						if changed:
							steps_to_update.append(step)

					if steps_to_update:
						WorkflowStep.objects.bulk_update(
							steps_to_update,
							["role_required", "approver_scope", "approver_department", "approver_user", "updated_at"],
						)
				else:
					WorkflowStep.objects.filter(workflow=workflow).delete()
					WorkflowStep.objects.bulk_create(
						[
							WorkflowStep(
								workflow=workflow,
								step_order=item["step_order"],
								role_required=item["role_required"],
								approver_scope=item.get("approver_scope", WorkflowStep.ApproverScope.ALL_WITH_ROLE),
								approver_department_id=item.get("approver_department"),
								approver_user_id=item.get("approver_user"),
							)
							for item in steps_data
						]
					)

		result_workflow.refresh_from_db()
		payload = WorkflowSerializer(result_workflow).data
		payload["version_created"] = version_created
		if version_created:
			payload["detail"] = "Đã tạo phiên bản workflow mới do quy trình cũ đã có lịch sử phê duyệt."
		return Response(payload, status=status.HTTP_200_OK)

	def _build_versioned_workflow_name(self, requested_name):
		base_name = re.sub(r"\s*\(v\d+\)$", "", requested_name.strip(), flags=re.IGNORECASE).strip()
		if not base_name:
			base_name = requested_name.strip() or "Workflow"

		existing_names = list(
			Workflow.objects.filter(name__startswith=base_name).values_list("name", flat=True)
		)
		version = 1
		pattern = re.compile(rf"^{re.escape(base_name)}\s*\(v(\d+)\)$", re.IGNORECASE)
		for name in existing_names:
			if name.strip().lower() == base_name.lower():
				version = max(version, 1)
				continue
			match = pattern.match(name.strip())
			if match:
				version = max(version, int(match.group(1)))

		return f"{base_name} (v{version + 1})"

	@action(detail=True, methods=["get"], url_path="instances")
	def instances(self, request, pk=None):
		"""GET /workflows/:id/instances/ — list WorkflowInstances for this workflow."""
		workflow = self.get_object()
		qs = workflow.instances.select_related("request").order_by("-started_at")
		return Response(WorkflowInstanceSerializer(qs, many=True).data)


class ApprovalTemplateViewSet(viewsets.ModelViewSet):
	"""
	CRUD for ApprovalTemplate.
	Only ADMIN can create/update/delete; all users can list/retrieve.
	"""
	serializer_class = ApprovalTemplateSerializer
	permission_classes = [IsAuthenticated]

	def get_queryset(self):
		qs = ApprovalTemplate.objects.select_related("workflow").order_by("type", "name")
		# Only show active templates to non-admin users
		if not user_has_role(self.request.user, "admin"):
			qs = qs.filter(is_active=True)
		return qs

	def create(self, request, *args, **kwargs):
		if not user_has_role(request.user, "admin"):
			return Response(
				{"detail": "Only administrators can create approval templates."},
				status=status.HTTP_403_FORBIDDEN,
			)
		return super().create(request, *args, **kwargs)

	def update(self, request, *args, **kwargs):
		if not user_has_role(request.user, "admin"):
			return Response(
				{"detail": "Only administrators can update approval templates."},
				status=status.HTTP_403_FORBIDDEN,
			)
		return super().update(request, *args, **kwargs)

	def destroy(self, request, *args, **kwargs):
		if not user_has_role(request.user, "admin"):
			return Response(
				{"detail": "Only administrators can delete approval templates."},
				status=status.HTTP_403_FORBIDDEN,
			)
		return super().destroy(request, *args, **kwargs)
