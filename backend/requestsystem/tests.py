from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APITestCase

from approvals.models import RequestApproval, Workflow, WorkflowStep
from requestsystem.models import Request


class RequestVisibilityApiTests(APITestCase):
	def setUp(self):
		self.User = get_user_model()

		self.creator = self.User.objects.create_user(
			username="creator_req",
			email="creator_req@example.com",
			password="pass1234",
		)
		self.approver = self.User.objects.create_user(
			username="approver_req",
			email="approver_req@example.com",
			password="pass1234",
		)
		self.unrelated = self.User.objects.create_user(
			username="unrelated_req",
			email="unrelated_req@example.com",
			password="pass1234",
		)

	def _extract_request_ids(self, response_data):
		payload = response_data.get("results", response_data) if isinstance(response_data, dict) else response_data
		return {item.get("id") for item in payload or []}

	def test_requests_list_creator_sees_own_request_unrelated_does_not(self):
		req = Request.objects.create(
			title="Creator private request",
			description="Visibility test",
			type=Request.RequestType.TASK,
			created_by=self.creator,
			target_type=Request.TargetType.USER,
			target_id=self.creator.id,
		)

		self.client.force_authenticate(user=self.creator)
		response_creator = self.client.get("/api/requests/")
		self.assertEqual(response_creator.status_code, 200)
		self.assertIn(req.id, self._extract_request_ids(response_creator.data))

		self.client.force_authenticate(user=self.unrelated)
		response_unrelated = self.client.get("/api/requests/")
		self.assertEqual(response_unrelated.status_code, 200)
		self.assertNotIn(req.id, self._extract_request_ids(response_unrelated.data))

	def test_requests_list_approval_actor_sees_related_request(self):
		workflow = Workflow.objects.create(name="WF Request Visibility", type=Workflow.WorkflowType.TASK)
		step = WorkflowStep.objects.create(
			workflow=workflow,
			step_order=1,
			role_required="manager",
		)
		req = Request.objects.create(
			title="Approval visibility request",
			description="Visibility test for approver",
			type=Request.RequestType.APPROVAL,
			category=Request.Category.TASK,
			created_by=self.creator,
			target_type=Request.TargetType.USER,
			target_id=0,
			workflow=workflow,
		)
		RequestApproval.objects.create(
			request=req,
			step=step,
			approver=self.approver,
			status=RequestApproval.Status.PENDING,
		)

		self.client.force_authenticate(user=self.approver)
		response_approver = self.client.get("/api/requests/", {"type": "APPROVAL"})
		self.assertEqual(response_approver.status_code, 200)
		self.assertIn(req.id, self._extract_request_ids(response_approver.data))

		self.client.force_authenticate(user=self.unrelated)
		response_unrelated = self.client.get("/api/requests/", {"type": "APPROVAL"})
		self.assertEqual(response_unrelated.status_code, 200)
		self.assertNotIn(req.id, self._extract_request_ids(response_unrelated.data))

	def test_requests_list_needs_my_approval_only_returns_actionable_rows(self):
		workflow = Workflow.objects.create(name="WF Needs My Approval", type=Workflow.WorkflowType.TASK)
		step_1 = WorkflowStep.objects.create(
			workflow=workflow,
			step_order=1,
			role_required="manager",
		)
		step_2 = WorkflowStep.objects.create(
			workflow=workflow,
			step_order=2,
			role_required="manager",
		)

		actionable_req = Request.objects.create(
			title="Actionable approval",
			description="Should be visible in needs_my_approval",
			type=Request.RequestType.APPROVAL,
			category=Request.Category.TASK,
			created_by=self.creator,
			target_type=Request.TargetType.USER,
			target_id=0,
			workflow=workflow,
			status=Request.Status.PENDING_APPROVAL,
			current_step=1,
		)
		RequestApproval.objects.create(
			request=actionable_req,
			step=step_1,
			approver=self.approver,
			status=RequestApproval.Status.PENDING,
		)

		non_actionable_future_step = Request.objects.create(
			title="Future step approval",
			description="Pending but not at current step",
			type=Request.RequestType.APPROVAL,
			category=Request.Category.TASK,
			created_by=self.creator,
			target_type=Request.TargetType.USER,
			target_id=0,
			workflow=workflow,
			status=Request.Status.PENDING_APPROVAL,
			current_step=1,
		)
		RequestApproval.objects.create(
			request=non_actionable_future_step,
			step=step_2,
			approver=self.approver,
			status=RequestApproval.Status.PENDING,
		)

		own_created_non_approval = Request.objects.create(
			title="Own task",
			description="Created by approver, should not be shown by needs_my_approval",
			type=Request.RequestType.TASK,
			created_by=self.approver,
			target_type=Request.TargetType.USER,
			target_id=self.approver.id,
		)

		self.client.force_authenticate(user=self.approver)
		response = self.client.get("/api/requests/", {"type": "APPROVAL", "needs_my_approval": "1"})
		self.assertEqual(response.status_code, 200)

		ids = self._extract_request_ids(response.data)
		self.assertIn(actionable_req.id, ids)
		self.assertNotIn(non_actionable_future_step.id, ids)
		self.assertNotIn(own_created_non_approval.id, ids)

	def test_requests_list_can_filter_by_category(self):
		leave_request = Request.objects.create(
			title="Leave approval",
			description="Leave category",
			type=Request.RequestType.APPROVAL,
			category=Request.Category.LEAVE,
			created_by=self.creator,
			target_type=Request.TargetType.USER,
			target_id=0,
		)
		purchase_request = Request.objects.create(
			title="Purchase approval",
			description="Purchase category",
			type=Request.RequestType.APPROVAL,
			category=Request.Category.PURCHASE,
			created_by=self.creator,
			target_type=Request.TargetType.USER,
			target_id=0,
		)

		self.client.force_authenticate(user=self.creator)
		response = self.client.get("/api/requests/", {"type": "APPROVAL", "category": Request.Category.LEAVE})
		self.assertEqual(response.status_code, 200)

		ids = self._extract_request_ids(response.data)
		self.assertIn(leave_request.id, ids)
		self.assertNotIn(purchase_request.id, ids)

	def test_requests_list_type_task_excludes_approval_requests(self):
		task_request = Request.objects.create(
			title="Visible task request",
			description="Regular task should remain in request list",
			type=Request.RequestType.TASK,
			created_by=self.creator,
			target_type=Request.TargetType.USER,
			target_id=self.creator.id,
		)
		approval_request = Request.objects.create(
			title="Hidden approval request",
			description="Approval should not appear in task-only request list",
			type=Request.RequestType.APPROVAL,
			category=Request.Category.TASK,
			created_by=self.creator,
			target_type=Request.TargetType.USER,
			target_id=0,
		)

		self.client.force_authenticate(user=self.creator)
		response = self.client.get("/api/requests/", {"type": "TASK"})
		self.assertEqual(response.status_code, 200)

		ids = self._extract_request_ids(response.data)
		self.assertIn(task_request.id, ids)
		self.assertNotIn(approval_request.id, ids)

	def test_requests_list_created_today_filters_current_date_only(self):
		today_request = Request.objects.create(
			title="Today's task request",
			description="Should appear in created_today filter",
			type=Request.RequestType.TASK,
			created_by=self.creator,
			target_type=Request.TargetType.USER,
			target_id=self.creator.id,
		)
		old_request = Request.objects.create(
			title="Older task request",
			description="Should be excluded from created_today filter",
			type=Request.RequestType.TASK,
			created_by=self.creator,
			target_type=Request.TargetType.USER,
			target_id=self.creator.id,
		)
		Request.objects.filter(id=old_request.id).update(created_at=timezone.now() - timezone.timedelta(days=1))

		self.client.force_authenticate(user=self.creator)
		response = self.client.get("/api/requests/", {"type": "TASK", "created_today": "1"})
		self.assertEqual(response.status_code, 200)

		ids = self._extract_request_ids(response.data)
		self.assertIn(today_request.id, ids)
		self.assertNotIn(old_request.id, ids)

	def test_creator_can_update_and_delete_approval_before_any_decision(self):
		workflow = Workflow.objects.create(name="WF Creator Edit/Delete", type=Workflow.WorkflowType.TASK)
		step = WorkflowStep.objects.create(
			workflow=workflow,
			step_order=1,
			role_required="manager",
		)
		req = Request.objects.create(
			title="Editable approval request",
			description="Creator should be able to edit/delete",
			type=Request.RequestType.APPROVAL,
			category=Request.Category.TASK,
			created_by=self.creator,
			target_type=Request.TargetType.USER,
			target_id=0,
			workflow=workflow,
			status=Request.Status.PENDING_APPROVAL,
		)
		RequestApproval.objects.create(
			request=req,
			step=step,
			approver=self.approver,
			status=RequestApproval.Status.PENDING,
		)

		self.client.force_authenticate(user=self.creator)
		patch_response = self.client.patch(f"/api/requests/{req.id}/", {"title": "Updated by creator"}, format="json")
		self.assertEqual(patch_response.status_code, 200)

		delete_response = self.client.delete(f"/api/requests/{req.id}/")
		self.assertEqual(delete_response.status_code, 204)
		self.assertFalse(Request.objects.filter(id=req.id).exists())

	def test_creator_cannot_update_or_delete_approval_after_any_decision(self):
		workflow = Workflow.objects.create(name="WF Lock After Decision", type=Workflow.WorkflowType.TASK)
		step = WorkflowStep.objects.create(
			workflow=workflow,
			step_order=1,
			role_required="manager",
		)
		req = Request.objects.create(
			title="Locked approval request",
			description="Creator should be blocked after decision",
			type=Request.RequestType.APPROVAL,
			category=Request.Category.TASK,
			created_by=self.creator,
			target_type=Request.TargetType.USER,
			target_id=0,
			workflow=workflow,
			status=Request.Status.PENDING_APPROVAL,
		)
		RequestApproval.objects.create(
			request=req,
			step=step,
			approver=self.approver,
			status=RequestApproval.Status.APPROVED,
		)

		self.client.force_authenticate(user=self.creator)

		patch_response = self.client.patch(f"/api/requests/{req.id}/", {"title": "Should fail"}, format="json")
		self.assertEqual(patch_response.status_code, 403)

		delete_response = self.client.delete(f"/api/requests/{req.id}/")
		self.assertEqual(delete_response.status_code, 403)
		self.assertTrue(Request.objects.filter(id=req.id).exists())
