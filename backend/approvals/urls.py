from django.urls import include, path
from rest_framework.routers import DefaultRouter

from approvals.views import ApprovalTemplateViewSet, RequestApprovalViewSet, WorkflowViewSet

router = DefaultRouter()
router.register("approvals", RequestApprovalViewSet, basename="approval")
router.register("workflows", WorkflowViewSet, basename="workflow")
router.register("templates", ApprovalTemplateViewSet, basename="template")

urlpatterns = [
    path("", include(router.urls)),
]
