import { useState, useEffect, useCallback } from 'react';
import {
  Card, Table, Button, Modal, Form, Select, Switch, Space, Tag, Typography, message, Popconfirm, Tabs,
  Descriptions, Empty,
} from 'antd';
import {
  PlusOutlined, DeleteOutlined, UserOutlined, BankOutlined, SafetyOutlined, LinkOutlined,
} from '@ant-design/icons';
import {
  getAttendancePermissions, createAttendancePermission, deleteAttendancePermission,
  getEmployees, updateEmployeeMapping,
} from '../../services/attendanceApi';
import api from '../../services/api';

const { Title } = Typography;

const PAGE_OPTIONS = [
  { value: 'monthly', label: 'Bảng công tháng' },
  { value: 'logs', label: 'Lịch sử chấm công' },
  { value: 'report', label: 'Báo cáo chấm công' },
];

/* ── Attendance Permissions Tab ─────────────────────────── */
function PermissionsTab() {
  const [permissions, setPermissions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [form] = Form.useForm();
  const [grantType, setGrantType] = useState('user');

  const fetchPermissions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAttendancePermissions();
      setPermissions(res.data.results || []);
    } catch {
      message.error('Không thể tải danh sách phân quyền');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLookups = useCallback(async () => {
    try {
      const [uRes, dRes] = await Promise.all([
        api.get('/users/lookup/'),
        api.get('/departments/', { params: { page_size: 9999 } }),
      ]);
      setUsers(uRes.data || []);
      setDepartments(dRes.data?.results || dRes.data || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchPermissions(); fetchLookups(); }, [fetchPermissions, fetchLookups]);

  const handleCreate = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        page: values.page,
        can_view_all: values.can_view_all || false,
      };
      if (grantType === 'user') {
        payload.user = values.user;
      } else {
        payload.department = values.department;
      }
      await createAttendancePermission(payload);
      message.success('Đã thêm phân quyền');
      setModalOpen(false);
      form.resetFields();
      fetchPermissions();
    } catch (err) {
      if (err?.response?.data) {
        message.error(JSON.stringify(err.response.data));
      }
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteAttendancePermission(id);
      message.success('Đã xóa phân quyền');
      fetchPermissions();
    } catch {
      message.error('Không thể xóa');
    }
  };

  const columns = [
    {
      title: 'Đối tượng',
      key: 'target',
      render: (_, r) => r.user
        ? <span><UserOutlined /> {r.user_name || r.username}</span>
        : <span><BankOutlined /> {r.department_name}</span>,
    },
    { title: 'Trang', dataIndex: 'page_display', key: 'page' },
    {
      title: 'Xem tất cả',
      dataIndex: 'can_view_all',
      key: 'can_view_all',
      render: v => v ? <Tag color="green">Có</Tag> : <Tag>Không</Tag>,
    },
    {
      title: '',
      key: 'actions',
      width: 80,
      render: (_, r) => (
        <Popconfirm title="Xóa phân quyền này?" onConfirm={() => handleDelete(r.id)} okText="Xóa" cancelText="Hủy">
          <Button type="text" danger icon={<DeleteOutlined />} size="small" />
        </Popconfirm>
      ),
    },
  ];

  return (
    <>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          Thêm phân quyền
        </Button>
      </div>
      <Table
        dataSource={permissions}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={false}
        size="small"
        locale={{ emptyText: <Empty description="Chưa có phân quyền nào" /> }}
      />

      <Modal
        title="Thêm phân quyền chấm công"
        open={modalOpen}
        onOk={handleCreate}
        onCancel={() => { setModalOpen(false); form.resetFields(); }}
        okText="Thêm"
        cancelText="Hủy"
      >
        <Form form={form} layout="vertical">
          <Form.Item label="Phân quyền cho">
            <Select value={grantType} onChange={setGrantType}
              options={[
                { value: 'user', label: 'Nhân viên' },
                { value: 'department', label: 'Phòng ban' },
              ]}
            />
          </Form.Item>
          {grantType === 'user' ? (
            <Form.Item name="user" label="Nhân viên" rules={[{ required: true, message: 'Chọn nhân viên' }]}>
              <Select placeholder="Chọn nhân viên" showSearch optionFilterProp="label"
                options={users.map(u => ({ value: u.id, label: `${u.full_name || u.username} (${u.username})` }))}
              />
            </Form.Item>
          ) : (
            <Form.Item name="department" label="Phòng ban" rules={[{ required: true, message: 'Chọn phòng ban' }]}>
              <Select placeholder="Chọn phòng ban" showSearch optionFilterProp="label"
                options={departments.map(d => ({ value: d.id, label: d.name }))}
              />
            </Form.Item>
          )}
          <Form.Item name="page" label="Trang được truy cập" rules={[{ required: true, message: 'Chọn trang' }]}>
            <Select placeholder="Chọn trang" options={PAGE_OPTIONS} />
          </Form.Item>
          <Form.Item name="can_view_all" label="Cho phép xem tất cả nhân viên" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}

/* ── Employee Mapping Tab ───────────────────────────────── */
function MappingTab() {
  const [users, setUsers] = useState([]);
  const [attEmployees, setAttEmployees] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [uRes, eRes] = await Promise.all([
        api.get('/users/', { params: { page_size: 9999 } }),
        getEmployees(),
      ]);
      setUsers(uRes.data?.results || []);
      setAttEmployees(eRes.data?.results || []);
    } catch {
      message.error('Không thể tải dữ liệu');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleMapping = async (erpUserId, deviceEmployeeId) => {
    try {
      await updateEmployeeMapping({
        user_id: erpUserId,
        attendance_employee_id: deviceEmployeeId || null,
      });
      message.success('Đã cập nhật liên kết');
      fetchData();
    } catch (err) {
      message.error(err?.response?.data?.error || 'Lỗi khi cập nhật');
    }
  };

  const columns = [
    {
      title: 'Tài khoản',
      key: 'user',
      render: (_, r) => <span>{r.full_name || r.username} <Tag>{r.username}</Tag></span>,
    },
    { title: 'Phòng ban', dataIndex: 'department_name', key: 'dept' },
    {
      title: 'Nhân viên chấm công',
      key: 'mapping',
      width: 320,
      render: (_, r) => (
        <Select
          allowClear
          placeholder="Chọn nhân viên máy chấm công"
          style={{ width: '100%' }}
          value={r.attendance_employee || undefined}
          onChange={val => handleMapping(r.id, val ? attEmployees.find(e => e.id === val)?.user_id : null)}
          showSearch
          optionFilterProp="label"
          options={attEmployees.map(e => ({ value: e.id, label: `${e.user_id} - ${e.name}` }))}
        />
      ),
    },
    {
      title: 'Mã CC',
      key: 'att_uid',
      width: 100,
      render: (_, r) => r.attendance_employee_uid || <Tag color="default">Chưa gán</Tag>,
    },
  ];

  return (
    <Table
      dataSource={users}
      columns={columns}
      rowKey="id"
      loading={loading}
      pagination={{ defaultPageSize: 20, showSizeChanger: true, pageSizeOptions: ['10', '20', '50', '100'], showTotal: t => `Tổng: ${t} tài khoản` }}
      size="small"
    />
  );
}

/* ── Main Page ────────────────────────────────────────── */
export default function AttendancePermissions() {
  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>
        <SafetyOutlined /> Phân quyền & Liên kết chấm công
      </Title>
      <Card>
        <Tabs
          defaultActiveKey="permissions"
          items={[
            {
              key: 'permissions',
              label: <span><SafetyOutlined /> Phân quyền truy cập</span>,
              children: <PermissionsTab />,
            },
            {
              key: 'mapping',
              label: <span><LinkOutlined /> Liên kết tài khoản ↔ Máy chấm công</span>,
              children: <MappingTab />,
            },
          ]}
        />
      </Card>
    </div>
  );
}
