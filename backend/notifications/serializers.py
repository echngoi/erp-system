from rest_framework import serializers

from common.serializers import TimestampedModelSerializer
from notifications.models import Notification


class NotificationSerializer(TimestampedModelSerializer):
    class Meta:
        model = Notification
        fields = [
            "id",
            "user",
            "content",
            "type",
            "is_read",
            "created_at",
        ]

    def validate_content(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError("content cannot be empty.")
        return value
