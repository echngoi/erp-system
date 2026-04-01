from django.utils import timezone
from rest_framework.exceptions import ValidationError

from approvals.models import RequestApproval, WorkflowInstance, WorkflowStep
from requestsystem.models import Request
from users.models import User


def _resolve_approvers_for_step(step, req):
    """
    Resolve the list of approvers for a workflow step based on its approver_scope.

    Scopes:
      ALL_WITH_ROLE       – everyone with the step role (original behaviour).
      DEPT_OF_REQUESTER   – users with the role that share the creator’s department.
      SPECIFIC_DEPT       – users with the role in the configured department.
      SPECIFIC_USER       – a single hand-picked user (must have the role).
    """
    scope = step.approver_scope
    Scope = WorkflowStep.ApproverScope
    role = step.role_required

    if scope == Scope.SPECIFIC_USER:
        user = step.approver_user
        if not user or not user.is_active:
            raise ValidationError(
                {"detail": f"Configured approver user for step {step.step_order} is missing or inactive."}
            )
        return User.objects.filter(pk=user.pk)

    if scope == Scope.SPECIFIC_DEPT:
        dept = step.approver_department
        if not dept:
            raise ValidationError(
                {"detail": f"Configured approver department for step {step.step_order} is not set."}
            )
        approvers = User.objects.filter(
            user_roles__role__name__iexact=role,
            department=dept,
            is_active=True,
        ).distinct().order_by("id")
        if not approvers.exists():
            raise ValidationError(
                {"detail": f"No active {role} found in department '{dept.name}'."}
            )
        return approvers

    if scope == Scope.DEPT_OF_REQUESTER:
        creator = req.created_by
        dept = getattr(creator, "department", None)
        if not dept:
            # Fallback: everyone with the role if creator has no department
            approvers = User.objects.filter(
                user_roles__role__name__iexact=role,
                is_active=True,
            ).distinct().order_by("id")
        else:
            approvers = User.objects.filter(
                user_roles__role__name__iexact=role,
                department=dept,
                is_active=True,
            ).distinct().order_by("id")

        if not approvers.exists():
            dept_name = dept.name if dept else "(no department)"
            raise ValidationError(
                {"detail": f"No active {role} found in department '{dept_name}'. Cannot route request."}
            )
        return approvers

    # Default: ALL_WITH_ROLE
    approvers = User.objects.filter(
        user_roles__role__name__iexact=role,
        is_active=True,
    ).distinct().order_by("id")
    if not approvers.exists():
        raise ValidationError({"detail": f"No active approver found for role '{role}'."})
    return approvers


def _creator_matches_step_role(req, step):
    """Return True when the request creator bears the same role as the step requires."""
    creator = req.created_by
    return creator.user_roles.filter(role__name__iexact=step.role_required).exists()


def activate_step_for_request(req, step):
    """
    Assign approvers for a workflow step.

    Auto-skip logic: if the request creator has the same role as the step
    requires, the step is auto-approved on behalf of the creator and the
    service immediately tries to advance to the next step.
    """
    # --- Auto-skip when creator’s role matches step role ---
    if _creator_matches_step_role(req, step):
        # Record the step as auto-approved so the full audit trail is intact.
        RequestApproval.objects.create(
            request=req,
            step=step,
            approver=req.created_by,
            status=RequestApproval.Status.APPROVED,
            note="Auto-approved: requester has the required role for this step.",
        )
        req.current_step = step.step_order
        req.status = Request.Status.PENDING_APPROVAL
        req.save(update_fields=["current_step", "status", "updated_at"])
        WorkflowInstance.objects.filter(request=req).update(current_step=step.step_order)

        # Try to advance immediately
        next_step = (
            WorkflowStep.objects.filter(
                workflow=req.workflow,
                step_order__gt=step.step_order,
            )
            .order_by("step_order")
            .first()
        )
        if next_step:
            activate_step_for_request(req, next_step)
        else:
            # No more steps – the whole workflow is finished
            req.status = Request.Status.APPROVED
            req.save(update_fields=["status", "updated_at"])
            complete_workflow_instance(req)
        return

    # --- Normal path ---
    approvers = _resolve_approvers_for_step(step, req)

    # Exclude the request creator from the approver list to avoid self-approval.
    approvers = [u for u in approvers if u.pk != req.created_by_id]
    if not approvers:
        raise ValidationError(
            {"detail": (
                f"No eligible approver found for step {step.step_order} after excluding the requester. "
                "Please reconfigure the approver scope."
            )}
        )

    RequestApproval.objects.bulk_create(
        [
            RequestApproval(
                request=req,
                step=step,
                approver=user,
                status=RequestApproval.Status.PENDING,
            )
            for user in approvers
        ]
    )

    req.current_step = step.step_order
    req.status = Request.Status.PENDING_APPROVAL
    req.save(update_fields=["current_step", "status", "updated_at"])

    WorkflowInstance.objects.filter(request=req).update(current_step=step.step_order)


def initialize_first_workflow_step(req):
    if req.type != Request.RequestType.APPROVAL:
        raise ValidationError({"detail": "Only APPROVAL request can start workflow."})

    if not req.workflow_id:
        raise ValidationError({"detail": "workflow is required for APPROVAL request."})

    if req.approvals.exists():
        raise ValidationError({"detail": "Workflow has already been initialized for this request."})

    first_step = (
        WorkflowStep.objects.filter(workflow=req.workflow)
        .order_by("step_order")
        .first()
    )
    if not first_step:
        raise ValidationError({"detail": "Selected workflow has no steps."})

    # Ensure instance exists before activation so auto-skip chains can keep it in sync,
    # including the edge case where all steps are auto-approved immediately.
    WorkflowInstance.objects.get_or_create(
        request=req,
        defaults={
            "workflow": req.workflow,
            "current_step": first_step.step_order,
            "status": WorkflowInstance.Status.ACTIVE,
        },
    )

    activate_step_for_request(req, first_step)

    # Final sync in case recursive auto-skip advanced or completed the workflow.
    instance_status = WorkflowInstance.Status.COMPLETED if req.status == Request.Status.APPROVED else WorkflowInstance.Status.ACTIVE
    WorkflowInstance.objects.filter(request=req).update(
        workflow=req.workflow,
        current_step=req.current_step,
        status=instance_status,
    )


def complete_workflow_instance(req):
    """Mark the WorkflowInstance as COMPLETED when the last step is approved."""
    WorkflowInstance.objects.filter(request=req, status=WorkflowInstance.Status.ACTIVE).update(
        status=WorkflowInstance.Status.COMPLETED,
        completed_at=timezone.now(),
    )


def reject_workflow_instance(req):
    """Mark the WorkflowInstance as REJECTED when any step is rejected."""
    WorkflowInstance.objects.filter(request=req, status=WorkflowInstance.Status.ACTIVE).update(
        status=WorkflowInstance.Status.REJECTED,
        completed_at=timezone.now(),
    )
