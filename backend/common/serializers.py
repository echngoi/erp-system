from rest_framework import serializers


class TimestampedModelSerializer(serializers.ModelSerializer):
    """Auto-mark created_at/updated_at as read-only when present."""

    timestamp_read_only_fields = ("created_at", "updated_at")

    def get_fields(self):
        fields = super().get_fields()
        for name in self.timestamp_read_only_fields:
            if name in fields:
                fields[name].read_only = True
        return fields
