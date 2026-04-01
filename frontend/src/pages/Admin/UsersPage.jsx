import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Input, message, Popconfirm, Select, Space, Table, Tag } from 'antd';
import api from '../../services/api';
import AdminSectionPage from './AdminSectionPage';
import { normalizeList } from './utils';
import UserFormModal from './UserFormModal';

const ROLE_NAME_LABELS = {
  admin: 'Quản trị viên',
  manager: 'Quản lý',
  staff: 'Nhân viên',
};

function getRoleNameLabel(roleName) {
  const normalized = String(roleName || '').toLowerCase();
  return ROLE_NAME_LABELS[normalized] || roleName || '-';
}

export default function UsersPage() {
  const [items, setItems] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [rbacRoles, setRbacRoles] = useState([]);
  const [roleFilter, setRoleFilter] = useState('ALL');
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [modalState, setModalState] = useState({
    open: false,
    mode: 'create',
    record: null,
  });
  const [lockingId, setLockingId] = useState(null);
  const [unlockingId, setUnlockingId] = useState(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const params = {};
      if (roleFilter !== 'ALL') params.role_id = roleFilter;
      if (departmentFilter !== 'ALL') params.department = departmentFilter;
      if (searchKeyword.trim()) params.q = searchKeyword.trim();

      const [usersResponse, departmentsResponse, rolesResponse] = await Promise.all([
        api.get('/users/', { params: { ...params, page_size: 9999 } }),
        api.get('/departments/', { params: { page_size: 9999 } }),
        api.get('/roles/', { params: { page_size: 9999 } }),
      ]);

      setItems(normalizeList(usersResponse.data));
      setDepartments(normalizeList(departmentsResponse.data));
      setRbacRoles(normalizeList(rolesResponse.data));
    } catch {
      setError('Không thể tải danh sách người dùng.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [departmentFilter, roleFilter, searchKeyword]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openCreateModal = () => {
    setModalState({ open: true, mode: 'create', record: null });
  };

  const openEditModal = (record) => {
    setModalState({
      open: true,
      mode: 'edit',
      record: {
        ...record,
        role_id: record.roles?.[0]?.id,
      },
    });
  };

  const closeModal = () => {
    setModalState((prev) => ({ ...prev, open: false, record: null }));
  };

  const handleSubmit = async (payload) => {
    setSubmitting(true);
    try {
      const userPayload = {
        ...payload,
        role_ids: payload.role_id ? [payload.role_id] : [],
      };
      delete userPayload.role_id;

      if (modalState.mode === 'edit' && modalState.record?.id) {
        await api.put(`/users/${modalState.record.id}/`, userPayload);
        message.success('Cập nhật người dùng thành công.');
      } else {
        await api.post('/users/', userPayload);
        message.success('Tạo người dùng thành công.');
      }
      closeModal();
      loadData();
    } catch (submitError) {
      const detail = submitError?.response?.data?.detail;
      message.error(detail || 'Không thể lưu thông tin người dùng.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleLockAccount = async (record) => {
    setLockingId(record.id);
    try {
      await api.delete(`/users/${record.id}/`);
      message.success('Đã khóa tài khoản.');
      loadData();
    } catch (lockError) {
      const detail = lockError?.response?.data?.detail;
      message.error(detail || 'Không thể khóa tài khoản.');
    } finally {
      setLockingId(null);
    }
  };

  const handleUnlockAccount = async (record) => {
    setUnlockingId(record.id);
    try {
      await api.patch(`/users/${record.id}/`, { is_active: true });
      message.success('Đã mở khóa tài khoản.');
      loadData();
    } catch (unlockError) {
      const detail = unlockError?.response?.data?.detail;
      message.error(detail || 'Không thể mở khóa tài khoản.');
    } finally {
      setUnlockingId(null);
    }
  };

  const departmentOptions = useMemo(
    () => [
      { label: 'Tất cả phòng ban', value: 'ALL' },
      ...departments.map((department) => ({
        label: department.name,
        value: String(department.id),
      })),
    ],
    [departments],
  );

  const formDepartmentOptions = useMemo(
    () => departments.map((department) => ({
      label: department.name,
      value: department.id,
    })),
    [departments],
  );

  const columns = useMemo(
    () => [
      {
        title: 'Tên đăng nhập',
        dataIndex: 'username',
        key: 'username',
        width: 160,
      },
      {
        title: 'Họ và tên',
        dataIndex: 'full_name',
        key: 'full_name',
        width: 200,
        render: (value) => value || '-',
      },
      {
        title: 'Phòng ban',
        dataIndex: 'department_name',
        key: 'department_name',
        width: 180,
        render: (value) => value || '-',
      },
      {
        title: 'Vai trò',
        dataIndex: 'roles',
        key: 'roles',
        width: 220,
        render: (roles) => {
          if (!Array.isArray(roles) || roles.length === 0) return '-';
          return (
            <Space wrap>
              {roles.map((role) => (
                <Tag key={role.id} color="purple">{getRoleNameLabel(role.name)}</Tag>
              ))}
            </Space>
          );
        },
      },
      {
        title: 'Email',
        dataIndex: 'email',
        key: 'email',
        width: 220,
        render: (value) => value || '-',
      },
      {
        title: 'Trạng thái',
        dataIndex: 'is_active',
        key: 'is_active',
        width: 120,
        render: (value) => <Tag color={value ? 'green' : 'default'}>{value ? 'Đang hoạt động' : 'Đã khóa'}</Tag>,
      },
      {
        title: 'Thao tác',
        key: 'actions',
        width: 220,
        fixed: 'right',
        render: (_, record) => (
          <Space>
            <Button size="small" onClick={() => openEditModal(record)}>
              Sửa
            </Button>
            {record.is_active ? (
              <Popconfirm
                title="Khóa tài khoản"
                description={`Bạn có chắc muốn khóa tài khoản ${record.username}?`}
                okText="Khóa"
                cancelText="Hủy"
                onConfirm={() => handleLockAccount(record)}
              >
                <Button
                  size="small"
                  danger
                  loading={lockingId === record.id}
                >
                  Khóa
                </Button>
              </Popconfirm>
            ) : (
              <Popconfirm
                title="Mở khóa tài khoản"
                description={`Bạn có chắc muốn mở khóa tài khoản ${record.username}?`}
                okText="Mở khóa"
                cancelText="Hủy"
                onConfirm={() => handleUnlockAccount(record)}
              >
                <Button
                  size="small"
                  type="primary"
                  ghost
                  loading={unlockingId === record.id}
                >
                  Mở khóa
                </Button>
              </Popconfirm>
            )}
          </Space>
        ),
      },
    ],
    [lockingId, unlockingId],
  );

  const roleFilterOptions = useMemo(
    () => [
      { label: 'Tất cả vai trò', value: 'ALL' },
      ...rbacRoles.map((role) => ({ label: getRoleNameLabel(role.name), value: String(role.id) })),
    ],
    [rbacRoles],
  );

  const formRoleOptions = useMemo(
    () => rbacRoles.map((role) => ({ label: role.name, value: role.id })),
    [rbacRoles],
  );

  return (
    <AdminSectionPage
      title="Người dùng"
      badge={`${items.length} bản ghi`}
      description="Danh sách người dùng lấy trực tiếp từ API quản trị, có lọc theo vai trò và phòng ban."
      extra={(
        <Space wrap>
          <Input.Search
            placeholder="Tìm tên đăng nhập, họ tên, email..."
            value={searchKeyword}
            onChange={(e) => setSearchKeyword(e.target.value)}
            style={{ width: 250 }}
            allowClear
          />
          <Select value={roleFilter} options={roleFilterOptions} onChange={setRoleFilter} style={{ width: 180 }} />
          <Select
            value={departmentFilter}
            options={departmentOptions}
            onChange={setDepartmentFilter}
            style={{ width: 180 }}
          />
          <Button type="primary" onClick={openCreateModal}>Tạo người dùng</Button>
          <Button onClick={loadData}>Tải lại</Button>
        </Space>
      )}
    >
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}
      <Table rowKey="id" loading={loading} columns={columns} dataSource={items} scroll={{ x: 1360 }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'], showTotal: t => `Tổng: ${t} người dùng` }} />
      <UserFormModal
        open={modalState.open}
        mode={modalState.mode}
        departments={formDepartmentOptions}
        roleOptions={formRoleOptions}
        initialValues={modalState.record}
        submitting={submitting}
        onCancel={closeModal}
        onSubmit={handleSubmit}
      />
    </AdminSectionPage>
  );
}
