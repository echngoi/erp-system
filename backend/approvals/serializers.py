from django.db.models import Max, Q
import re
from rest_framework import serializers

from approvals.models import (
    ApprovalTemplate,
    RequestApproval,
    Workflow,
    WorkflowInstance,
    WorkflowStep,
)
from common.serializers import TimestampedModelSerializer
from rbac.models import Role


def _allowed_workflow_roles() -> list[str]:
    return list(Role.objects.values_list("name", flat=True))


def _validate_step_scope_fields(attrs):
    scope = attrs.get("approver_scope", WorkflowStep.ApproverScope.ALL_WITH_ROLE)
    department = attrs.get("approver_department")
    user = attrs.get("approver_user")

    if scope == WorkflowStep.ApproverScope.SPECIFIC_DEPT and not department:
        raise serializers.ValidationError({"approver_department": "This field is required for SPECIFIC_DEPT scope."})

    if scope == WorkflowStep.ApproverScope.SPECIFIC_USER and not user:
        raise serializers.ValidationError({"approver_user": "This field is required for SPECIFIC_USER scope."})

    if scope != WorkflowStep.ApproverScope.SPECIFIC_DEPT:
        attrs["approver_department"] = None

    if scope != WorkflowStep.ApproverScope.SPECIFIC_USER:
        attrs["approver_user"] = None

    return attrs


class WorkflowStepSerializer(TimestampedModelSerializer):
    class Meta:
        model = WorkflowStep
        fields = [
            "id",
            "workflow",
            "step_order",
            "role_required",
            "approver_scope",
            "approver_department",
            "approver_user",
            "created_at",
            "updated_at",
        ]

    def validate_role_required(self, value):
        allowed_roles = set(_allowed_workflow_roles())
        if value not in allowed_roles:
            raise serializers.ValidationError(f"role_required must be one of: {', '.join(sorted(allowed_roles))}")
        return value


class WorkflowStepWriteSerializer(serializers.ModelSerializer):
    """Used when adding a step through WorkflowViewSet.add_step; workflow is set from URL."""

    class Meta:
        model = WorkflowStep
        fields = [
            "id",
            "step_order",
            "role_required",
            "approver_scope",
            "approver_department",
            "approver_user",
        ]

    def validate_role_required(self, value):
        allowed_roles = set(_allowed_workflow_roles())
        if value not in allowed_roles:
            raise serializers.ValidationError(
                f"role_required must be one of: {', '.join(sorted(allowed_roles))}"
            )
        return value

    def validate(self, attrs):
        attrs = _validate_step_scope_fields(attrs)
        return attrs


class WorkflowStepInputSerializer(serializers.Serializer):
    """Input serializer for replace-steps action."""

    step_order = serializers.IntegerField(min_value=1)
    role_required = serializers.CharField(max_length=20)
    approver_scope = serializers.ChoiceField(
        choices=WorkflowStep.ApproverScope.choices,
        default=WorkflowStep.ApproverScope.ALL_WITH_ROLE,
        required=False,
    )
    approver_department = serializers.IntegerField(required=False, allow_null=True, min_value=1)
    approver_user = serializers.IntegerField(required=False, allow_null=True, min_value=1)

    def validate_role_required(self, value):
        allowed_roles = set(_allowed_workflow_roles())
        if value not in allowed_roles:
            raise serializers.ValidationError(
                f"role_required must be one of: {', '.join(sorted(allowed_roles))}"
            )
        return value

    def validate(self, attrs):
        attrs = _validate_step_scope_fields(attrs)
        return attrs


class WorkflowStepsReplaceSerializer(serializers.Serializer):
    """Payload serializer for replacing full step list of a workflow."""

    name = serializers.CharField(required=False, allow_blank=False, max_length=255)
    description = serializers.CharField(required=False, allow_blank=True)
    steps = WorkflowStepInputSerializer(many=True, allow_empty=False)

    def validate_steps(self, steps):
        step_orders = [step["step_order"] for step in steps]

        # Prevent duplicated step orders in the same payload.
        if len(step_orders) != len(set(step_orders)):
            raise serializers.ValidationError("step_order values must be unique.")

        # Keep definition strict and predictable: 1..N contiguous.
        expected = list(range(1, len(step_orders) + 1))
        if sorted(step_orders) != expected:
            raise serializers.ValidationError(
                "step_order must be contiguous starting from 1 (e.g. 1,2,3...)."
            )

        return steps


class WorkflowSerializer(TimestampedModelSerializer):
    steps = WorkflowStepSerializer(many=True, read_only=True)
    is_latest_version = serializers.SerializerMethodField(read_only=True)

    class Meta:
        model = Workflow
        fields = [
            "id",
            "name",
            "type",
            "description",
            "steps",
            "is_latest_version",
            "created_at",
            "updated_at",
        ]

    def get_is_latest_version(self, obj):
        # Extract base name by removing version suffix (v...)
        base_name = re.sub(r"\s*\(v\d+\)$", "", obj.name, flags=re.IGNORECASE).strip()
        if not base_name:
            base_name = obj.name

        # Find all workflows with same base name and type
        pattern = f"{re.escape(base_name)}(\\s*\\(v\\d+\\))?$"
        same_family = Workflow.objects.filter(
            type=obj.type,
            name__iregex=pattern,
        )

        if not same_family.exists():
            return True

        # Get the one with latest updated_at
        latest = same_family.order_by("-updated_at").first()
        return obj.id == latest.id if latest else True


class WorkflowWriteSerializer(serializers.ModelSerializer):
    """Used for create/update – excludes nested steps."""

    class Meta:
        model = Workflow
        fields = ["id", "name", "type", "description"]


class WorkflowInstanceSerializer(TimestampedModelSerializer):
    workflow_name = serializers.CharField(source="workflow.name", read_only=True)
    workflow_type = serializers.CharField(source="workflow.type", read_only=True)

    class Meta:
        model = WorkflowInstance
        fields = [
            "id",
            "request",
            "workflow",
            "workflow_name",
            "workflow_type",
            "current_step",
            "status",
            "started_at",
            "completed_at",
        ]


class ApprovalTemplateSerializer(TimestampedModelSerializer):
    workflow_name = serializers.CharField(source="workflow.name", read_only=True)
    workflow_type = serializers.CharField(source="workflow.type", read_only=True)

    class Meta:
        model = ApprovalTemplate
        fields = [
            "id",
            "type",
            "name",
            "description",
            "schema",
            "workflow",
            "workflow_name",
            "workflow_type",
            "is_active",
            "created_at",
            "updated_at",
        ]


class RequestApprovalSerializer(TimestampedModelSerializer):
    class Meta:
        model = RequestApproval
        fields = [
            "id",
            "request",
            "step",
            "approver",
            "status",
            "note",
            "created_at",
            "updated_at",
        ]

    def validate(self, attrs):
        request_obj = attrs.get("request") or getattr(self.instance, "request", None)
        step = attrs.get("step") or getattr(self.instance, "step", None)

        if request_obj and step and request_obj.workflow_id and step.workflow_id != request_obj.workflow_id:
            raise serializers.ValidationError({"step": "Approval step must belong to request workflow."})
        return attrs
