from django.utils import timezone
from rest_framework import serializers

from approvals.models import RequestApproval
from common.serializers import TimestampedModelSerializer
from departments.models import Department
from requestsystem.models import Rating, Request, RequestAssignment, RequestAttachment, RequestLog, RequestQuickTitle


class RequestAssignmentSerializer(TimestampedModelSerializer):
    class Meta:
        model = RequestAssignment
        fields = [
            "id",
            "request",
            "user",
            "status",
            "action_at",
            "created_at",
            "updated_at",
        ]

    def validate(self, attrs):
        status = attrs.get("status")
        action_at = attrs.get("action_at")
        if status and status != RequestAssignment.Status.PENDING and not action_at:
            attrs["action_at"] = timezone.now()
        return attrs


class RequestLogSerializer(TimestampedModelSerializer):
    class Meta:
        model = RequestLog
        fields = [
            "id",
            "request",
            "user",
            "action",
            "note",
            "created_at",
            "updated_at",
        ]


class RatingSerializer(TimestampedModelSerializer):
    class Meta:
        model = Rating
        fields = [
            "id",
            "request",
            "rating",
            "comment",
            "created_by",
            "created_at",
            "updated_at",
        ]

    def validate_rating(self, value):
        if value < 1 or value > 5:
            raise serializers.ValidationError("rating must be between 1 and 5.")
        return value


class RequestApprovalInlineSerializer(TimestampedModelSerializer):
    step_order = serializers.IntegerField(source="step.step_order", read_only=True)

    class Meta:
        model = RequestApproval
        fields = [
            "id",
            "step",
            "step_order",
            "approver",
            "status",
            "note",
            "created_at",
            "updated_at",
        ]


class RequestAttachmentSerializer(TimestampedModelSerializer):
    file_url = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = RequestAttachment
        fields = [
            "id",
            "request",
            "file",
            "file_url",
            "file_name",
            "file_size",
            "mime_type",
            "uploaded_by",
            "created_at",
            "updated_at",
        ]

    def get_file_url(self, obj):
        request = self.context.get("request")
        if not obj.file:
            return ""
        if request is not None:
            return request.build_absolute_uri(obj.file.url)
        return obj.file.url


class RequestSerializer(TimestampedModelSerializer):
    target_type = serializers.ChoiceField(
        choices=Request.TargetType.choices,
        required=False,
        allow_blank=True,
        default="",
    )
    target_id = serializers.IntegerField(required=False, default=0, min_value=0)
    target_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        write_only=True,
        required=False,
        allow_empty=False,
    )
    target_department_name = serializers.SerializerMethodField(read_only=True)
    assignments = RequestAssignmentSerializer(many=True, read_only=True)
    logs = RequestLogSerializer(many=True, read_only=True)
    ratings = RatingSerializer(many=True, read_only=True)
    approvals = RequestApprovalInlineSerializer(many=True, read_only=True)
    attachments = RequestAttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = Request
        fields = [
            "id",
            "title",
            "description",
            "notes",
            "type",
            "category",
            "form_data",
            "created_by",
            "target_type",
            "target_id",
            "target_ids",
            "target_department_name",
            "status",
            "priority",
            "deadline",
            "workflow",
            "current_step",
            "parent_request",
            "assignments",
            "logs",
            "ratings",
            "approvals",
            "attachments",
            "created_at",
            "updated_at",
        ]
        read_only_fields = [
            "created_by",
            "status",
            "current_step",
            "assignments",
            "logs",
            "ratings",
            "approvals",
            "attachments",
            "created_at",
            "updated_at",
        ]

    def get_target_department_name(self, obj):
        if obj.target_type == Request.TargetType.DEPARTMENT:
            try:
                return Department.objects.get(pk=obj.target_id).name
            except Department.DoesNotExist:
                return None
        return None

    def validate(self, attrs):
        request_type = attrs.get("type") or getattr(self.instance, "type", None)
        category = attrs.get("category") or getattr(self.instance, "category", None)
        deadline = attrs.get("deadline")
        workflow = attrs.get("workflow") or getattr(self.instance, "workflow", None)
        target_type = attrs.get("target_type") or getattr(self.instance, "target_type", None)
        target_ids = attrs.get("target_ids")

        if deadline and deadline <= timezone.now():
            raise serializers.ValidationError({"deadline": "deadline must be in the future."})

        if request_type == Request.RequestType.APPROVAL and workflow is None and not category:
            raise serializers.ValidationError({"detail": "Either workflow or category is required for APPROVAL requests."})

        # For APPROVAL requests target_type/target_id are not meaningful; set safe defaults.
        if request_type == Request.RequestType.APPROVAL:
            if not attrs.get("target_type"):
                attrs["target_type"] = Request.TargetType.USER
            if not attrs.get("target_id"):
                attrs["target_id"] = 0
        else:
            if not attrs.get("target_type"):
                raise serializers.ValidationError({"target_type": "This field is required for non-APPROVAL requests."})
            if not attrs.get("target_id"):
                raise serializers.ValidationError({"target_id": "This field is required for non-APPROVAL requests."})

        if target_type == Request.TargetType.USER and target_ids:
            normalized_ids = list(dict.fromkeys(int(value) for value in target_ids))
            attrs["target_ids"] = normalized_ids
            attrs["target_id"] = normalized_ids[0]

        return attrs

    def create(self, validated_data):
        target_ids = validated_data.pop("target_ids", None)
        instance = super().create(validated_data)
        instance._target_ids = target_ids
        return instance

    def update(self, instance, validated_data):
        validated_data.pop("target_ids", None)
        return super().update(instance, validated_data)


class RequestQuickTitleSerializer(serializers.ModelSerializer):
    class Meta:
        model = RequestQuickTitle
        fields = ["id", "title", "description", "is_active", "sort_order", "created_at", "updated_at"]
        read_only_fields = ["created_at", "updated_at"]
