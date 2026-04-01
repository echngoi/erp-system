from django.conf import settings
from django.db import models


class Notification(models.Model):
	class NotificationType(models.TextChoices):
		REQUEST = "REQUEST", "Request"
		APPROVAL = "APPROVAL", "Approval"
		MESSAGE = "MESSAGE", "Message"

	user = models.ForeignKey(
		settings.AUTH_USER_MODEL,
		on_delete=models.CASCADE,
		related_name="notifications",
	)
	content = models.TextField()
	type = models.CharField(max_length=20, choices=NotificationType.choices)
	is_read = models.BooleanField(default=False)
	created_at = models.DateTimeField(auto_now_add=True)

	class Meta:
		db_table = "notifications"
		indexes = [
			models.Index(fields=["user", "is_read"]),
			models.Index(fields=["user", "created_at"]),
			models.Index(fields=["type"]),
		]
		ordering = ["-created_at"]

	def __str__(self) -> str:
		return f"{self.user_id} - {self.type}"

	def mark_as_read(self, save=True):
		if self.is_read:
			return self

		self.is_read = True
		if save:
			self.save(update_fields=["is_read"])
		return self
