import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, message, Popconfirm, Space, Table, Tag } from 'antd';
import api from '../../services/api';
import AssignPermissionsModal from './AssignPermissionsModal';
import AdminSectionPage from './AdminSectionPage';
import RoleFormModal from './RoleFormModal';
import { normalizeList } from './utils';

const REQUIRED_PERMISSIONS = [
  { code: 'create_request', name: 'Tạo yêu cầu' },
  { code: 'approve_request', name: 'Duyệt yêu cầu' },
  { code: 'manage_user', name: 'Quản lý người dùng' },
];

const DEFAULT_ROLES = [
  { name: 'admin', description: 'Vai trò quản trị hệ thống' },
  { name: 'manager', description: 'Vai trò quản lý phê duyệt và điều phối' },
  { name: 'staff', description: 'Vai trò nhân viên xử lý công việc' },
];

const PROTECTED_ROLE_NAMES = new Set(DEFAULT_ROLES.map((role) => role.name));

const ROLE_NAME_LABELS = {
  admin: 'Quản trị viên',
  manager: 'Quản lý',
  staff: 'Nhân viên',
};

function getRoleNameLabel(roleName) {
  const normalized = String(roleName || '').toLowerCase();
  return ROLE_NAME_LABELS[normalized] || roleName || '-';
}

export default function RolesPage() {
  const [items, setItems] = useState([]);
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [formModalState, setFormModalState] = useState({
    open: false,
    mode: 'create',
    role: null,
  });
  const [assignModalState, setAssignModalState] = useState({
    open: false,
    role: null,
    selectedPermissionIds: [],
  });
  const [submitting, setSubmitting] = useState(false);

  const ensureRequiredPermissions = useCallback(async () => {
    const permissionResponse = await api.get('/permissions/');
    let currentPermissions = normalizeList(permissionResponse.data);

    const missingPermissions = REQUIRED_PERMISSIONS.filter(
      (requiredPermission) => !currentPermissions.some((item) => item.code === requiredPermission.code),
    );

    if (missingPermissions.length > 0) {
      await Promise.all(
        missingPermissions.map((permission) => api.post('/permissions/', permission)),
      );
      const refreshedResponse = await api.get('/permissions/');
      currentPermissions = normalizeList(refreshedResponse.data);
    }

    return currentPermissions;
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const permissionList = await ensureRequiredPermissions();

      const rolesResponse = await api.get('/roles/', { params: { page_size: 9999 } });
      let currentRoles = normalizeList(rolesResponse.data);

      const missingRoles = DEFAULT_ROLES.filter(
        (requiredRole) => !currentRoles.some((item) => item.name?.toLowerCase() === requiredRole.name),
      );

      if (missingRoles.length > 0) {
        await Promise.all(missingRoles.map((role) => api.post('/roles/', role)));
        const refreshedRoles = await api.get('/roles/', { params: { page_size: 9999 } });
        currentRoles = normalizeList(refreshedRoles.data);
      }

      setItems(currentRoles);
      setPermissions(permissionList);
    } catch {
      setError('Không thể tải danh sách vai trò.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [ensureRequiredPermissions]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openAssignPermissionModal = (role) => {
    setAssignModalState({
      open: true,
      role,
      selectedPermissionIds: (role.permissions || []).map((permission) => permission.id),
    });
  };

  const closeAssignPermissionModal = () => {
    setAssignModalState({
      open: false,
      role: null,
      selectedPermissionIds: [],
    });
  };

  const handleSaveRole = async (payload) => {
    setSubmitting(true);
    try {
      if (formModalState.mode === 'edit' && formModalState.role?.id) {
        await api.put(`/roles/${formModalState.role.id}/`, payload);
        message.success('Cập nhật vai trò thành công.');
      } else {
        await api.post('/roles/', payload);
        message.success('Tạo vai trò thành công.');
      }
      setFormModalState({ open: false, mode: 'create', role: null });
      loadData();
    } catch (submitError) {
      const detail = submitError?.response?.data?.detail;
      message.error(detail || 'Không thể lưu vai trò.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteRole = async (role) => {
    if (!role?.id) return;
    if (PROTECTED_ROLE_NAMES.has(String(role.name).toLowerCase())) {
      message.warning('Không thể xóa vai trò hệ thống mặc định.');
      return;
    }

    setSubmitting(true);
    try {
      await api.delete(`/roles/${role.id}/`);
      message.success('Xóa vai trò thành công.');
      loadData();
    } catch (submitError) {
      const detail = submitError?.response?.data?.detail;
      message.error(detail || 'Không thể xóa vai trò.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAssignPermissions = async () => {
    if (!assignModalState.role?.id) return;

    setSubmitting(true);
    try {
      await api.post(`/roles/${assignModalState.role.id}/assign-permissions/`, {
        permission_ids: assignModalState.selectedPermissionIds,
      });
      message.success('Gán quyền thành công.');
      closeAssignPermissionModal();
      loadData();
    } catch (submitError) {
      const detail = submitError?.response?.data?.detail;
      message.error(detail || 'Không thể gán quyền.');
    } finally {
      setSubmitting(false);
    }
  };

  const columns = useMemo(
    () => [
      {
        title: 'Tên vai trò',
        dataIndex: 'name',
        key: 'name',
        width: 220,
        render: (value) => getRoleNameLabel(value),
      },
      {
        title: 'Mô tả',
        dataIndex: 'description',
        key: 'description',
        width: 320,
        render: (value) => value || '-',
      },
      {
        title: 'Quyền',
        dataIndex: 'permissions',
        key: 'permissions',
        render: (permissions) => (
          <Space wrap>
            {(permissions || []).length > 0
              ? permissions.map((permission) => (
                <Tag key={permission.id} color="purple">{permission.code}</Tag>
              ))
              : '-'}
          </Space>
        ),
      },
      {
        title: 'Thao tác',
        key: 'actions',
        width: 320,
        render: (_, record) => (
          <Space wrap>
            {PROTECTED_ROLE_NAMES.has(String(record.name).toLowerCase()) ? (
              <Tag color="gold">Vai trò hệ thống</Tag>
            ) : null}
            <Button
              size="small"
              onClick={() => setFormModalState({ open: true, mode: 'edit', role: record })}
            >
              Sửa
            </Button>
            <Popconfirm
              title="Xóa vai trò"
              description={`Bạn có chắc muốn xóa vai trò ${record.name}?`}
              okText="Xóa"
              cancelText="Hủy"
              onConfirm={() => handleDeleteRole(record)}
              disabled={PROTECTED_ROLE_NAMES.has(String(record.name).toLowerCase())}
            >
              <Button
                size="small"
                danger
                loading={submitting}
                disabled={PROTECTED_ROLE_NAMES.has(String(record.name).toLowerCase())}
              >
                Xóa
              </Button>
            </Popconfirm>
            <Button size="small" onClick={() => openAssignPermissionModal(record)}>
              Gán quyền
            </Button>
          </Space>
        ),
      },
    ],
    [submitting],
  );

  const requiredPermissionCodes = useMemo(
    () => REQUIRED_PERMISSIONS.map((item) => item.code),
    [],
  );

  return (
    <AdminSectionPage
      title="Vai trò"
      badge={`${items.length} vai trò`}
      description="Danh sách vai trò RBAC và quyền đang được gán trên hệ thống."
      extra={(
        <Space wrap>
          <Button
            type="primary"
            onClick={() => setFormModalState({ open: true, mode: 'create', role: null })}
          >
            Tạo vai trò
          </Button>
          <Button onClick={loadData}>Tải lại</Button>
        </Space>
      )}
    >
      <Space wrap size={8} style={{ marginBottom: 14 }}>
        {requiredPermissionCodes.map((code) => (
          <Tag key={code} color="geekblue">{code}</Tag>
        ))}
      </Space>
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}
      <Table rowKey="id" loading={loading} columns={columns} dataSource={items} scroll={{ x: 960 }} />

      <RoleFormModal
        open={formModalState.open}
        mode={formModalState.mode}
        initialValues={formModalState.role}
        submitting={submitting}
        onCancel={() => setFormModalState({ open: false, mode: 'create', role: null })}
        onSubmit={handleSaveRole}
      />

      <AssignPermissionsModal
        open={assignModalState.open}
        role={assignModalState.role}
        permissions={permissions}
        selectedPermissionIds={assignModalState.selectedPermissionIds}
        submitting={submitting}
        onChange={(values) => {
          setAssignModalState((prev) => ({
            ...prev,
            selectedPermissionIds: values,
          }));
        }}
        onCancel={closeAssignPermissionModal}
        onSubmit={handleAssignPermissions}
      />
    </AdminSectionPage>
  );
}
