from django.db import migrations


def backfill_rbac_roles(apps, schema_editor):
    User = apps.get_model("users", "User")
    Role = apps.get_model("rbac", "Role")
    UserRole = apps.get_model("rbac", "UserRole")

    admin_role, _ = Role.objects.get_or_create(
        name="admin",
        defaults={"description": "Vai trò quản trị hệ thống"},
    )
    manager_role, _ = Role.objects.get_or_create(
        name="manager",
        defaults={"description": "Vai trò quản lý phê duyệt và điều phối"},
    )
    staff_role, _ = Role.objects.get_or_create(
        name="staff",
        defaults={"description": "Vai trò nhân viên xử lý công việc"},
    )

    existing_user_ids = set(UserRole.objects.values_list("user_id", flat=True))
    pending_links = []

    for user in User.objects.all().iterator():
        if user.id in existing_user_ids:
            continue

        if user.is_superuser:
            role_id = admin_role.id
        elif user.is_staff:
            role_id = manager_role.id
        else:
            role_id = staff_role.id

        pending_links.append(UserRole(user_id=user.id, role_id=role_id))

    if pending_links:
        UserRole.objects.bulk_create(pending_links, ignore_conflicts=True)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("rbac", "0001_initial"),
        ("users", "0003_remove_user_users_role_0ace22_idx_remove_user_role"),
    ]

    operations = [
        migrations.RunPython(backfill_rbac_roles, noop_reverse),
    ]