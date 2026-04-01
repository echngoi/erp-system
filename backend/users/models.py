from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    full_name = models.CharField(max_length=255, blank=True)
    department = models.ForeignKey(
        "departments.Department",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="staff",
    )
    position = models.CharField(max_length=255, blank=True)
    attendance_employee = models.OneToOneField(
        "attendance.Employee",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="linked_user",
        help_text="Liên kết với nhân viên trên máy chấm công",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "users"
        indexes = [
            models.Index(fields=["username"]),
        ]

    def __str__(self) -> str:
        return self.username
