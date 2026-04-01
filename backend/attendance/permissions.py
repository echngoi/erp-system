"""
Attendance permission helpers.

Rules:
- Admin role → full access to all attendance pages.
- A user with an AttendancePermission record (direct or via department) → access
  to the specified page(s). If can_view_all=True they see everybody's data,
  otherwise only their own.
- Everyone else → only /attendance/monthly with their own data.
"""
from attendance.models import AttendancePermission
from rbac.utils import user_has_role


def _user_att_perms(user):
    """Return AttendancePermission queryset applicable to *user*."""
    from django.db.models import Q
    return AttendancePermission.objects.filter(
        Q(user=user) | Q(department__staff=user) | Q(department__members=user)
    ).distinct()


def get_allowed_pages(user):
    """Return set of page keys the user may access."""
    if user_has_role(user, 'admin'):
        return {'dashboard', 'live', 'logs', 'monthly', 'employees', 'report', 'device'}

    pages = {'monthly'}  # everyone can see monthly (own data)
    for perm in _user_att_perms(user):
        pages.add(perm.page)
    return pages


def can_view_all_on_page(user, page):
    """Return True if user may view ALL employees' data on *page*."""
    if user_has_role(user, 'admin'):
        return True
    return _user_att_perms(user).filter(page=page, can_view_all=True).exists()
