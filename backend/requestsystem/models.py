from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


class Request(models.Model):
	class RequestType(models.TextChoices):
		TASK = "TASK", "Task"
		APPROVAL = "APPROVAL", "Approval"

	class Category(models.TextChoices):
		"""Maps to Workflow.WorkflowType — used to auto-assign a workflow on creation."""
		LEAVE = "LEAVE", "Leave"
		PURCHASE = "PURCHASE", "Purchase"
		DOCUMENT = "DOCUMENT", "Document"
		TASK = "TASK", "Task"

	class TargetType(models.TextChoices):
		USER = "USER", "User"
		DEPARTMENT = "DEPARTMENT", "Department"

	class Status(models.TextChoices):
		CREATED = "CREATED", "Created"
		PENDING = "PENDING", "Pending"
		ACCEPTED = "ACCEPTED", "Accepted"
		REJECTED = "REJECTED", "Rejected"
		IN_PROGRESS = "IN_PROGRESS", "In Progress"
		DONE = "DONE", "Done"
		FAILED = "FAILED", "Failed"
		RATED = "RATED", "Rated"
		PENDING_APPROVAL = "PENDING_APPROVAL", "Pending Approval"
		APPROVED = "APPROVED", "Approved"

	class Priority(models.TextChoices):
		LOW = "LOW", "Low"
		MEDIUM = "MEDIUM", "Medium"
		HIGH = "HIGH", "High"

	title = models.CharField(max_length=255)
	description = models.TextField(blank=True)
	notes = models.TextField(blank=True, help_text="Rejection or failure reason visible to both sender and recipient")
	type = models.CharField(max_length=20, choices=RequestType.choices)
	category = models.CharField(
		max_length=20,
		choices=Category.choices,
		null=True,
		blank=True,
		db_index=True,
		help_text="Used to auto-assign a matching workflow on creation.",
	)
	form_data = models.JSONField(default=dict, blank=True)
	created_by = models.ForeignKey(
		settings.AUTH_USER_MODEL,
		on_delete=models.PROTECT,
		related_name="created_requests",
	)
	target_type = models.CharField(max_length=20, choices=TargetType.choices)
	target_id = models.PositiveBigIntegerField()
	status = models.CharField(max_length=30, choices=Status.choices, default=Status.CREATED)
	priority = models.CharField(max_length=20, choices=Priority.choices, default=Priority.MEDIUM)
	deadline = models.DateTimeField(null=True, blank=True)
	workflow = models.ForeignKey(
		"approvals.Workflow",
		null=True,
		blank=True,
		on_delete=models.SET_NULL,
		related_name="requests",
	)
	current_step = models.PositiveIntegerField(default=1)
	parent_request = models.ForeignKey(
		"self",
		null=True,
		blank=True,
		on_delete=models.SET_NULL,
		related_name="resubmitted_requests",
	)
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		db_table = "requests"
		indexes = [
			models.Index(fields=["type", "status"]),
			models.Index(fields=["target_type", "target_id"]),
			models.Index(fields=["created_by"]),
			models.Index(fields=["deadline"]),
			models.Index(fields=["workflow", "current_step"]),
			models.Index(fields=["created_at"]),
		]

	def __str__(self) -> str:
		return f"{self.title} [{self.type}]"


class RequestAttachment(models.Model):
	request = models.ForeignKey(
		Request,
		on_delete=models.CASCADE,
		related_name="attachments",
	)
	file = models.FileField(upload_to="request_attachments/%Y/%m/%d")
	uploaded_by = models.ForeignKey(
		settings.AUTH_USER_MODEL,
		null=True,
		blank=True,
		on_delete=models.SET_NULL,
		related_name="request_attachments",
	)
	file_name = models.CharField(max_length=255, blank=True, default="")
	file_size = models.PositiveBigIntegerField(null=True, blank=True)
	mime_type = models.CharField(max_length=100, blank=True, default="")
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		db_table = "request_attachments"
		indexes = [
			models.Index(fields=["request"]),
		]

	def __str__(self) -> str:
		return f"{self.request_id} - {self.file_name or self.file.name}"


class RequestAssignment(models.Model):
	class Status(models.TextChoices):
		PENDING = "PENDING", "Pending"
		ACCEPTED = "ACCEPTED", "Accepted"
		REJECTED = "REJECTED", "Rejected"
		CLOSED = "CLOSED", "Closed"
		DONE = "DONE", "Done"

	request = models.ForeignKey(
		Request,
		on_delete=models.CASCADE,
		related_name="assignments",
	)
	user = models.ForeignKey(
		settings.AUTH_USER_MODEL,
		on_delete=models.PROTECT,
		related_name="request_assignments",
	)
	status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
	action_at = models.DateTimeField(null=True, blank=True)
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		db_table = "request_assignments"
		constraints = [
			models.UniqueConstraint(fields=["request", "user"], name="uniq_request_assignment"),
		]
		indexes = [
			models.Index(fields=["request", "status"]),
			models.Index(fields=["user", "status"]),
			models.Index(fields=["action_at"]),
		]

	def __str__(self) -> str:
		return f"{self.request_id} -> {self.user_id} ({self.status})"


class RequestLog(models.Model):
	request = models.ForeignKey(
		Request,
		on_delete=models.CASCADE,
		related_name="logs",
	)
	user = models.ForeignKey(
		settings.AUTH_USER_MODEL,
		null=True,
		blank=True,
		on_delete=models.SET_NULL,
		related_name="request_logs",
	)
	action = models.CharField(max_length=100)
	note = models.TextField(blank=True)
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		db_table = "request_logs"
		indexes = [
			models.Index(fields=["request", "created_at"]),
			models.Index(fields=["user"]),
			models.Index(fields=["action"]),
		]

	def __str__(self) -> str:
		return f"{self.request_id} - {self.action}"


class Rating(models.Model):
	request = models.ForeignKey(
		Request,
		on_delete=models.CASCADE,
		related_name="ratings",
	)
	rating = models.PositiveSmallIntegerField(
		validators=[MinValueValidator(1), MaxValueValidator(5)]
	)
	comment = models.TextField(blank=True)
	created_by = models.ForeignKey(
		settings.AUTH_USER_MODEL,
		on_delete=models.PROTECT,
		related_name="created_ratings",
	)
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		db_table = "ratings"
		constraints = [
			models.UniqueConstraint(fields=["request", "created_by"], name="uniq_request_rating_by_user"),
		]
		indexes = [
			models.Index(fields=["request"]),
			models.Index(fields=["created_by"]),
			models.Index(fields=["rating"]),
		]

	def __str__(self) -> str:
		return f"{self.request_id} - {self.rating}"


class RequestQuickTitle(models.Model):
	"""Admin-configured quick titles for fast request creation."""

	title = models.CharField(max_length=255, unique=True)
	description = models.TextField(blank=True, help_text="Optional description/hint shown to users")
	is_active = models.BooleanField(default=True, db_index=True)
	sort_order = models.PositiveIntegerField(default=0, db_index=True)
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		db_table = "request_quick_titles"
		ordering = ["sort_order", "title"]

	def __str__(self) -> str:
		return self.title
