from rest_framework import serializers

from common.serializers import TimestampedModelSerializer
from departments.models import Department
from users.models import User


class DepartmentSerializer(TimestampedModelSerializer):
    manager = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(), allow_null=True, required=False
    )
    manager_name = serializers.CharField(source="manager.full_name", read_only=True, default=None)
    member_count = serializers.SerializerMethodField()

    class Meta:
        model = Department
        fields = [
            "id",
            "name",
            "description",
            "parent",
            "manager",
            "manager_name",
            "member_count",
            "created_at",
            "updated_at",
        ]

    def get_member_count(self, obj):
        return obj.staff.filter(is_active=True).count()

    def validate(self, attrs):
        parent = attrs.get("parent")
        instance = getattr(self, "instance", None)
        if parent and instance and parent.pk == instance.pk:
            raise serializers.ValidationError({"parent": "Department cannot be its own parent."})
        return attrs


class DepartmentLookupSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = [
            "id",
            "name",
            "description",
        ]
