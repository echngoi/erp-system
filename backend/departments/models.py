from django.conf import settings
from django.db import models


class Department(models.Model):
	name = models.CharField(max_length=255)
	description = models.TextField(blank=True)
	parent = models.ForeignKey(
		"self",
		null=True,
		blank=True,
		on_delete=models.SET_NULL,
		related_name="children",
	)
	manager = models.ForeignKey(
		settings.AUTH_USER_MODEL,
		null=True,
		blank=True,
		on_delete=models.SET_NULL,
		related_name="managed_departments",
	)
	members = models.ManyToManyField(
		settings.AUTH_USER_MODEL,
		blank=True,
		related_name="departments",
	)
	created_at = models.DateTimeField(auto_now_add=True)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		db_table = "departments"
		indexes = [
			models.Index(fields=["name"]),
			models.Index(fields=["parent"]),
			models.Index(fields=["manager"]),
		]

	def __str__(self) -> str:
		return self.name
