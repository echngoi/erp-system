import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Drawer, Empty, List, message, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import { TeamOutlined } from '@ant-design/icons';
import api from '../../services/api';
import AdminSectionPage from './AdminSectionPage';
import DepartmentFormModal from './DepartmentFormModal';
import { normalizeList } from './utils';

const { Text } = Typography;

export default function DepartmentsPage() {
  const [items, setItems] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [modalState, setModalState] = useState({
    open: false,
    mode: 'create',
    record: null,
  });
  const [memberDrawer, setMemberDrawer] = useState({
    open: false,
    department: null,
    members: [],
    loading: false,
    error: '',
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const [departmentsResponse, usersResponse] = await Promise.all([
        api.get('/departments/', { params: { page_size: 9999 } }),
        api.get('/users/', { params: { page_size: 9999 } }),
      ]);
      setItems(normalizeList(departmentsResponse.data));
      setUsers(normalizeList(usersResponse.data));
    } catch {
      setError('Không thể tải danh sách phòng ban.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openCreateModal = () => {
    setModalState({ open: true, mode: 'create', record: null });
  };

  const openEditModal = (record) => {
    setModalState({ open: true, mode: 'edit', record });
  };

  const closeModal = () => {
    setModalState((prev) => ({ ...prev, open: false, record: null }));
  };

  const handleSubmit = async (payload) => {
    setSubmitting(true);
    try {
      if (modalState.mode === 'edit' && modalState.record?.id) {
        await api.put(`/departments/${modalState.record.id}/`, payload);
        message.success('Cập nhật phòng ban thành công.');
      } else {
        await api.post('/departments/', payload);
        message.success('Tạo phòng ban thành công.');
      }
      closeModal();
      loadData();
    } catch (submitError) {
      const detail = submitError?.response?.data?.detail;
      message.error(detail || 'Không thể lưu phòng ban.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (record) => {
    setDeletingId(record.id);
    try {
      await api.delete(`/departments/${record.id}/`);
      message.success('Xóa phòng ban thành công.');
      loadData();
    } catch (deleteError) {
      const detail = deleteError?.response?.data?.detail;
      message.error(detail || 'Không thể xóa phòng ban.');
    } finally {
      setDeletingId(null);
    }
  };

  const openMemberDrawer = async (department) => {
    setMemberDrawer({
      open: true,
      department,
      members: [],
      loading: true,
      error: '',
    });

    try {
      const response = await api.get(`/departments/${department.id}/users/`);
      setMemberDrawer((prev) => ({
        ...prev,
        members: normalizeList(response.data),
        loading: false,
      }));
    } catch {
      setMemberDrawer((prev) => ({
        ...prev,
        loading: false,
        error: 'Không thể tải danh sách nhân viên của phòng ban.',
      }));
    }
  };

  const closeMemberDrawer = () => {
    setMemberDrawer({
      open: false,
      department: null,
      members: [],
      loading: false,
      error: '',
    });
  };

  const managerOptions = useMemo(
    () => users
      .filter((user) => user.is_active)
      .map((user) => ({
        label: user.full_name || user.username,
        value: user.id,
      })),
    [users],
  );

  const columns = useMemo(
    () => [
      {
        title: 'Phòng ban',
        dataIndex: 'name',
        key: 'name',
        width: 220,
        render: (value, record) => (
          <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openMemberDrawer(record)}>
            {value}
          </Button>
        ),
      },
      {
        title: 'Số nhân sự',
        dataIndex: 'member_count',
        key: 'member_count',
        width: 250,
        render: (value, record) => (
          <Space size={8}>
            <Tag color="geekblue">{value ?? 0}</Tag>
            <Button
              size="small"
              icon={<TeamOutlined />}
              onClick={() => openMemberDrawer(record)}
            >
              Xem nhân sự
            </Button>
          </Space>
        ),
      },
      {
        title: 'Quản lý',
        dataIndex: 'manager_name',
        key: 'manager_name',
        width: 180,
        render: (value) => value || '-',
      },
      {
        title: 'Mô tả',
        dataIndex: 'description',
        key: 'description',
        width: 300,
        render: (value) => value || '-',
      },
      {
        title: 'Thao tác',
        key: 'actions',
        width: 180,
        fixed: 'right',
        render: (_, record) => (
          <Space>
            <Button size="small" onClick={() => openEditModal(record)}>
              Sửa
            </Button>
            <Popconfirm
              title="Xóa phòng ban"
              description={`Bạn có chắc muốn xóa phòng ban ${record.name}?`}
              okText="Xóa"
              cancelText="Hủy"
              onConfirm={() => handleDelete(record)}
            >
              <Button size="small" danger loading={deletingId === record.id}>
                Xóa
              </Button>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [deletingId],
  );

  return (
    <AdminSectionPage
      title="Phòng ban"
      badge={`${items.length} phòng ban`}
      description="Theo dõi cấu trúc phòng ban, mô tả, quản lý và số lượng nhân sự theo dữ liệu backend."
      extra={(
        <Space wrap>
          <Button type="primary" onClick={openCreateModal}>Thêm phòng ban</Button>
          <Button onClick={loadData}>Tải lại</Button>
        </Space>
      )}
    >
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}
      <Table rowKey="id" loading={loading} columns={columns} dataSource={items} scroll={{ x: 1080 }} />

      <Drawer
        title={memberDrawer.department ? `Nhân sự phòng ${memberDrawer.department.name}` : 'Nhân sự phòng ban'}
        open={memberDrawer.open}
        onClose={closeMemberDrawer}
        width={480}
      >
        {memberDrawer.error ? (
          <Alert type="error" showIcon message={memberDrawer.error} style={{ marginBottom: 12 }} />
        ) : null}

        <List
          loading={memberDrawer.loading}
          dataSource={memberDrawer.members}
          locale={{
            emptyText: (
              <Empty
                description="Phòng ban này chưa có nhân viên hoạt động"
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ),
          }}
          renderItem={(member) => (
            <List.Item>
              <Space direction="vertical" size={2} style={{ width: '100%' }}>
                <Text strong>{member.full_name || member.username}</Text>
                <Text type="secondary">{member.email || 'Chưa có email'}</Text>
              </Space>
            </List.Item>
          )}
        />
      </Drawer>

      <DepartmentFormModal
        open={modalState.open}
        mode={modalState.mode}
        managers={managerOptions}
        initialValues={modalState.record}
        submitting={submitting}
        onCancel={closeModal}
        onSubmit={handleSubmit}
      />
    </AdminSectionPage>
  );
}
