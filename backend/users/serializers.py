from rest_framework import serializers

from attendance.models import Employee as AttEmployee
from common.serializers import TimestampedModelSerializer
from departments.models import Department
from rbac.models import Role, UserRole
from rbac.serializers import RoleSerializer
from users.models import User


class UserSerializer(TimestampedModelSerializer):
    password = serializers.CharField(write_only=True, required=False, min_length=8)
    department = serializers.PrimaryKeyRelatedField(
        queryset=Department.objects.all(), allow_null=True, required=False
    )
    department_name = serializers.CharField(source="department.name", read_only=True)
    roles = serializers.SerializerMethodField(read_only=True)
    role_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        write_only=True,
        required=False,
        allow_empty=True,
    )
    attendance_employee = serializers.PrimaryKeyRelatedField(
        queryset=AttEmployee.objects.all(), allow_null=True, required=False
    )
    attendance_employee_name = serializers.CharField(
        source="attendance_employee.name", read_only=True, default=""
    )
    attendance_employee_uid = serializers.CharField(
        source="attendance_employee.user_id", read_only=True, default=""
    )

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "password",
            "full_name",
            "email",
            "department",
            "department_name",
            "position",
            "is_active",
            "roles",
            "role_ids",
            "attendance_employee",
            "attendance_employee_name",
            "attendance_employee_uid",
            "created_at",
            "updated_at",
        ]

    def get_roles(self, obj):
        roles = Role.objects.filter(user_roles__user=obj).order_by("name")
        return RoleSerializer(roles, many=True).data

    def validate_full_name(self, value):
        return value.strip()

    def validate_position(self, value):
        return value.strip()

    def validate_role_ids(self, value):
        if not value:
            return []

        existing_ids = set(Role.objects.filter(id__in=value).values_list("id", flat=True))
        invalid_ids = sorted(set(value) - existing_ids)
        if invalid_ids:
            raise serializers.ValidationError(f"Invalid role IDs: {invalid_ids}")
        return list(dict.fromkeys(value))

    def _sync_roles(self, user, role_ids):
        UserRole.objects.filter(user=user).delete()
        UserRole.objects.bulk_create([UserRole(user=user, role_id=role_id) for role_id in role_ids])

    def create(self, validated_data):
        password = validated_data.pop("password", None)
        role_ids = validated_data.pop("role_ids", [])
        user = User(**validated_data)
        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()
        user.save()
        self._sync_roles(user, role_ids)
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)
        role_ids = validated_data.pop("role_ids", None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        if password:
            instance.set_password(password)
        instance.save()
        if role_ids is not None:
            self._sync_roles(instance, role_ids)
        return instance


class UserLookupSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "full_name",
            "email",
        ]
