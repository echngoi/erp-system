from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APITestCase

from approvals.models import RequestApproval, Workflow, WorkflowInstance, WorkflowStep
from approvals.serializers import WorkflowStepWriteSerializer
from approvals.services import initialize_first_workflow_step
from departments.models import Department
from rbac.models import Role, UserRole
from requestsystem.models import Request


class ApprovalWorkflowBehaviorTests(TestCase):
	def setUp(self):
		self.User = get_user_model()

		self.role_admin, _ = Role.objects.get_or_create(name="admin", defaults={"description": "Admin"})
		self.role_manager, _ = Role.objects.get_or_create(name="manager", defaults={"description": "Manager"})
		self.role_staff, _ = Role.objects.get_or_create(name="staff", defaults={"description": "Staff"})

		self.dept_a = Department.objects.create(name="Dept A")
		self.dept_b = Department.objects.create(name="Dept B")

	def _create_user(self, username, department=None):
		return self.User.objects.create_user(
			username=username,
			email=f"{username}@example.com",
			password="pass1234",
			department=department,
		)

	def _assign_role(self, user, role):
		UserRole.objects.create(user=user, role=role)

	def _create_approval_request(self, creator, workflow):
		return Request.objects.create(
			title="Approval test",
			description="Testing approval flow",
			type=Request.RequestType.APPROVAL,
			category=Request.Category.TASK,
			created_by=creator,
			target_type=Request.TargetType.USER,
			target_id=0,
			workflow=workflow,
		)

	def test_auto_skip_creator_role_advances_to_next_step(self):
		creator = self._create_user("creator_auto", department=self.dept_a)
		next_approver = self._create_user("next_admin", department=self.dept_b)

		self._assign_role(creator, self.role_manager)
		self._assign_role(next_approver, self.role_admin)

		workflow = Workflow.objects.create(name="WF Auto Skip", type=Workflow.WorkflowType.TASK)
		first_step = WorkflowStep.objects.create(
			workflow=workflow,
			step_order=1,
			role_required="manager",
			approver_scope=WorkflowStep.ApproverScope.ALL_WITH_ROLE,
		)
		second_step = WorkflowStep.objects.create(
			workflow=workflow,
			step_order=2,
			role_required="admin",
			approver_scope=WorkflowStep.ApproverScope.ALL_WITH_ROLE,
		)

		req = self._create_approval_request(creator, workflow)
		initialize_first_workflow_step(req)
		req.refresh_from_db()

		self.assertEqual(req.status, Request.Status.PENDING_APPROVAL)
		self.assertEqual(req.current_step, 2)

		auto_approval = RequestApproval.objects.get(request=req, step=first_step, approver=creator)
		self.assertEqual(auto_approval.status, RequestApproval.Status.APPROVED)

		pending_next = RequestApproval.objects.get(request=req, step=second_step, approver=next_approver)
		self.assertEqual(pending_next.status, RequestApproval.Status.PENDING)

		instance = WorkflowInstance.objects.get(request=req)
		self.assertEqual(instance.current_step, 2)
		self.assertEqual(instance.status, WorkflowInstance.Status.ACTIVE)

	def test_dept_of_requester_routes_to_same_department_approver(self):
		creator = self._create_user("creator_dept", department=self.dept_a)
		manager_a = self._create_user("manager_a", department=self.dept_a)
		manager_b = self._create_user("manager_b", department=self.dept_b)

		self._assign_role(creator, self.role_staff)
		self._assign_role(manager_a, self.role_manager)
		self._assign_role(manager_b, self.role_manager)

		workflow = Workflow.objects.create(name="WF Dept Scope", type=Workflow.WorkflowType.TASK)
		step = WorkflowStep.objects.create(
			workflow=workflow,
			step_order=1,
			role_required="manager",
			approver_scope=WorkflowStep.ApproverScope.DEPT_OF_REQUESTER,
		)

		req = self._create_approval_request(creator, workflow)
		initialize_first_workflow_step(req)

		approvals = RequestApproval.objects.filter(request=req, step=step)
		self.assertEqual(approvals.count(), 1)
		self.assertEqual(approvals.first().approver_id, manager_a.id)
		self.assertNotEqual(approvals.first().approver_id, manager_b.id)

	def test_scope_validation_requires_department_or_user_when_specific(self):
		serializer_dept = WorkflowStepWriteSerializer(
			data={
				"step_order": 1,
				"role_required": "manager",
				"approver_scope": WorkflowStep.ApproverScope.SPECIFIC_DEPT,
			}
		)
		self.assertFalse(serializer_dept.is_valid())
		self.assertIn("approver_department", serializer_dept.errors)

		serializer_user = WorkflowStepWriteSerializer(
			data={
				"step_order": 1,
				"role_required": "manager",
				"approver_scope": WorkflowStep.ApproverScope.SPECIFIC_USER,
			}
		)
		self.assertFalse(serializer_user.is_valid())
		self.assertIn("approver_user", serializer_user.errors)


class ApprovalVisibilityApiTests(APITestCase):
	def setUp(self):
		self.User = get_user_model()
		self.role_manager, _ = Role.objects.get_or_create(name="manager", defaults={"description": "Manager"})
		self.role_staff, _ = Role.objects.get_or_create(name="staff", defaults={"description": "Staff"})

		self.dept = Department.objects.create(name="Dept Visibility")

		self.creator = self.User.objects.create_user(
			username="creator_visibility",
			email="creator_visibility@example.com",
			password="pass1234",
			department=self.dept,
		)
		self.approver_a = self.User.objects.create_user(
			username="approver_a",
			email="approver_a@example.com",
			password="pass1234",
			department=self.dept,
		)
		self.approver_b = self.User.objects.create_user(
			username="approver_b",
			email="approver_b@example.com",
			password="pass1234",
			department=self.dept,
		)

		UserRole.objects.create(user=self.creator, role=self.role_staff)
		UserRole.objects.create(user=self.approver_a, role=self.role_manager)
		UserRole.objects.create(user=self.approver_b, role=self.role_manager)

		workflow = Workflow.objects.create(name="WF Visibility", type=Workflow.WorkflowType.TASK)
		WorkflowStep.objects.create(
			workflow=workflow,
			step_order=1,
			role_required="manager",
			approver_scope=WorkflowStep.ApproverScope.SPECIFIC_USER,
			approver_user=self.approver_a,
		)

		request_obj = Request.objects.create(
			title="Visibility Request",
			description="Visibility check",
			type=Request.RequestType.APPROVAL,
			category=Request.Category.TASK,
			created_by=self.creator,
			target_type=Request.TargetType.USER,
			target_id=0,
			workflow=workflow,
		)
		initialize_first_workflow_step(request_obj)

	def test_approvals_list_returns_only_current_user_assignments(self):
		self.client.force_authenticate(user=self.approver_a)
		response_a = self.client.get("/api/approvals/", {"status": "PENDING"})
		self.assertEqual(response_a.status_code, 200)
		count_a = response_a.data.get("count") if isinstance(response_a.data, dict) else len(response_a.data)
		self.assertEqual(count_a, 1)

		self.client.force_authenticate(user=self.approver_b)
		response_b = self.client.get("/api/approvals/", {"status": "PENDING"})
		self.assertEqual(response_b.status_code, 200)
		count_b = response_b.data.get("count") if isinstance(response_b.data, dict) else len(response_b.data)
		self.assertEqual(count_b, 0)
