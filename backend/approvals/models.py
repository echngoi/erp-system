from django.conf import settings
from django.db import models
from django.utils import timezone


class Workflow(models.Model):
	class WorkflowType(models.TextChoices):
		LEAVE = "LEAVE", "Leave"
		PURCHASE = "PURCHASE", "Purchase"
		DOCUMENT = "DOCUMENT", "Document"
		TASK = "TASK", "Task"

	name = models.CharField(max_length=255, unique=True)
	type = models.CharField(
		max_length=20,
		choices=WorkflowType.choices,
		default=WorkflowType.TASK,
		db_index=True,
	)
	description = models.TextField(blank=True)
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		db_table = "workflows"
		indexes = [models.Index(fields=["name"])]

	def __str__(self) -> str:
		return f"{self.name} [{self.type}]"


class WorkflowStep(models.Model):
	class ApproverScope(models.TextChoices):
		ALL_WITH_ROLE = "ALL_WITH_ROLE", "Tất cả người dùng có vai trò"
		DEPT_OF_REQUESTER = "DEPT_OF_REQUESTER", "Quản lý phòng ban của người tạo"
		SPECIFIC_DEPT = "SPECIFIC_DEPT", "Quản lý của phòng ban cụ thể"
		SPECIFIC_USER = "SPECIFIC_USER", "Người dùng cụ thể"

	workflow = models.ForeignKey(
		Workflow,
		on_delete=models.CASCADE,
		related_name="steps",
	)
	step_order = models.PositiveIntegerField()
	# role_required stores RBAC role name (e.g. admin | manager | staff)
	role_required = models.CharField(max_length=20)
	approver_scope = models.CharField(
		max_length=20,
		choices=ApproverScope.choices,
		default=ApproverScope.ALL_WITH_ROLE,
	)
	approver_department = models.ForeignKey(
		"departments.Department",
		null=True,
		blank=True,
		on_delete=models.SET_NULL,
		related_name="workflow_steps",
		help_text="Used when approver_scope=SPECIFIC_DEPT",
	)
	approver_user = models.ForeignKey(
		settings.AUTH_USER_MODEL,
		null=True,
		blank=True,
		on_delete=models.SET_NULL,
		related_name="designated_workflow_steps",
		help_text="Used when approver_scope=SPECIFIC_USER",
	)
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		db_table = "workflow_steps"
		constraints = [
			models.UniqueConstraint(fields=["workflow", "step_order"], name="uniq_workflow_step_order"),
		]
		indexes = [
			models.Index(fields=["workflow", "step_order"]),
			models.Index(fields=["role_required"]),
		]

	def __str__(self) -> str:
		return f"{self.workflow.name} – Step {self.step_order} ({self.role_required})"


class WorkflowInstance(models.Model):
	"""Tracks the live execution state of a Workflow on a specific Request."""

	class Status(models.TextChoices):
		ACTIVE = "ACTIVE", "Active"
		COMPLETED = "COMPLETED", "Completed"
		REJECTED = "REJECTED", "Rejected"

	request = models.OneToOneField(
		"requestsystem.Request",
		on_delete=models.CASCADE,
		related_name="workflow_instance",
	)
	workflow = models.ForeignKey(
		Workflow,
		on_delete=models.PROTECT,
		related_name="instances",
	)
	current_step = models.PositiveIntegerField(default=1)
	status = models.CharField(
		max_length=20,
		choices=Status.choices,
		default=Status.ACTIVE,
		db_index=True,
	)
	started_at = models.DateTimeField(default=timezone.now)
	completed_at = models.DateTimeField(null=True, blank=True)

	class Meta:
		db_table = "workflow_instances"
		indexes = [
			models.Index(fields=["status"]),
			models.Index(fields=["workflow", "status"]),
		]

	def __str__(self) -> str:
		return f"Instance[req={self.request_id}] {self.workflow.name} step={self.current_step}"


class RequestApproval(models.Model):
	class Status(models.TextChoices):
		PENDING = "PENDING", "Pending"
		APPROVED = "APPROVED", "Approved"
		REJECTED = "REJECTED", "Rejected"

	request = models.ForeignKey(
		"requestsystem.Request",
		on_delete=models.CASCADE,
		related_name="approvals",
	)
	step = models.ForeignKey(
		WorkflowStep,
		on_delete=models.PROTECT,
		related_name="request_approvals",
	)
	approver = models.ForeignKey(
		settings.AUTH_USER_MODEL,
		on_delete=models.PROTECT,
		related_name="request_approvals",
	)
	status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
	note = models.TextField(blank=True)
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		db_table = "request_approvals"
		constraints = [
			models.UniqueConstraint(
				fields=["request", "step", "approver"],
				name="uniq_request_approval_actor",
			),
		]
		indexes = [
			models.Index(fields=["request", "status"]),
			models.Index(fields=["approver", "status"]),
			models.Index(fields=["step"]),
		]

	def __str__(self) -> str:
		return f"{self.request_id} - Step {self.step_id} ({self.status})"


class ApprovalTemplate(models.Model):
	"""Reusable template for approval form, mapped to a specific workflow."""

	class TemplateType(models.TextChoices):
		LEAVE = "LEAVE", "Leave"
		PURCHASE = "PURCHASE", "Purchase"
		DOCUMENT = "DOCUMENT", "Document"

	type = models.CharField(
		max_length=20,
		choices=TemplateType.choices,
		db_index=True,
	)
	name = models.CharField(max_length=255)
	description = models.TextField(blank=True)
	schema = models.JSONField(
		default=list,
		blank=True,
		help_text="Array of field definitions: {name, label, input, required, options}",
	)
	workflow = models.ForeignKey(
		Workflow,
		on_delete=models.PROTECT,
		related_name="templates",
	)
	is_active = models.BooleanField(default=True, db_index=True)
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		db_table = "approval_templates"
		indexes = [
			models.Index(fields=["type", "is_active"]),
			models.Index(fields=["workflow"]),
		]
		constraints = [
			models.UniqueConstraint(
				fields=["type", "name"],
				name="uniq_template_type_name",
			),
		]

	def __str__(self) -> str:
		return f"{self.name} [{self.type}]"
