import { useEffect, useState } from 'react';
import {
  Table, Card, Button, Space, Tag, Typography,
  message, Avatar, Input, Switch, Select
} from 'antd';
import {
  UserOutlined, SyncOutlined, SearchOutlined,
  EyeOutlined, EyeInvisibleOutlined
} from '@ant-design/icons';
import { getEmployees, syncUsers, toggleEmployeeActive, bulkToggleEmployeeActive, getShifts, assignShift } from '../../services/attendanceApi';

const { Text } = Typography;

const PRIVILEGE_COLORS = { 0: 'blue', 14: 'red', 1: 'green' };
const PRIVILEGE_LABELS = { 0: 'Nhân viên', 14: 'Quản trị viên', 1: 'Người dùng' };

export default function EmployeesPage() {
  const [data, setData]       = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch]   = useState('');
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [shifts, setShifts] = useState([]);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getEmployees({ show_all: 1 });
      setData(res.data.results);
      setFiltered(res.data.results);
    } catch {
      message.error('Lỗi tải danh sách nhân viên');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    getShifts().then(r => setShifts(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    const q = search.toLowerCase();
    setFiltered(
      q ? data.filter(e =>
        (e.display_name || e.name)?.toLowerCase().includes(q) ||
        e.user_id?.toString().includes(q) ||
        e.department?.toLowerCase().includes(q)
      ) : data
    );
  }, [search, data]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await syncUsers();
      message.success(res.data.message);
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Lỗi đồng bộ nhân viên');
    } finally {
      setSyncing(false);
    }
  };

  const handleToggleActive = async (record) => {
    try {
      await toggleEmployeeActive(record.id, !record.is_active);
      message.success(`Đã ${record.is_active ? 'ẩn' : 'hiện'} nhân viên ${record.display_name || record.name}`);
      setData(prev => prev.map(e => e.id === record.id ? { ...e, is_active: !record.is_active } : e));
    } catch {
      message.error('Lỗi cập nhật trạng thái');
    }
  };

  const handleBulkToggle = async (isActive) => {
    setBulkLoading(true);
    try {
      const ids = filtered.filter(e => selectedRowKeys.includes(e.uid)).map(e => e.id);
      await bulkToggleEmployeeActive(ids, isActive);
      message.success(`Đã ${isActive ? 'hiện' : 'ẩn'} ${ids.length} nhân viên`);
      setData(prev => prev.map(e => ids.includes(e.id) ? { ...e, is_active: isActive } : e));
      setSelectedRowKeys([]);
    } catch {
      message.error('Lỗi cập nhật hàng loạt');
    } finally {
      setBulkLoading(false);
    }
  };

  const handleBulkAssignShift = async (shiftId) => {
    setBulkLoading(true);
    try {
      const ids = filtered.filter(e => selectedRowKeys.includes(e.uid)).map(e => e.id);
      await assignShift(ids, shiftId);
      message.success(`Đã gán ca cho ${ids.length} nhân viên`);
      load();
      setSelectedRowKeys([]);
    } catch {
      message.error('Lỗi gán ca');
    } finally {
      setBulkLoading(false);
    }
  };

  const departmentFilters = [...new Set(filtered.map(e => e.linked_department || e.department).filter(Boolean))]
    .sort()
    .map(d => ({ text: d, value: d }));

  const columns = [
    {
      title: 'Nhân viên',
      key: 'name',
      sorter: (a, b) => (a.display_name || a.name || '').localeCompare(b.display_name || b.name || '', 'vi'),
      render: (_, r) => (
        <Space>
          <Avatar style={{ background: r.is_active ? '#1677ff' : '#d9d9d9' }} icon={<UserOutlined />} />
          <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 200 }}>
            <Text strong style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {r.display_name || r.name || '(Chưa đặt tên)'}
            </Text>
            {r.employee_code && (
              <Text type="secondary" style={{ fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Mã NV: {r.employee_code}
              </Text>
            )}
            {r.linked_username && (
              <Text type="secondary" style={{ fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Tài khoản: {r.linked_username}
              </Text>
            )}
            <Text type="secondary" style={{ fontSize: 10, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              ID: {r.user_id}
            </Text>
          </div>
        </Space>
      ),
      width: 250,
    },
    {
      title: 'UID thiết bị',
      dataIndex: 'uid',
      width: 100,
      sorter: (a, b) => a.uid - b.uid,
      render: v => <Text code>{v}</Text>,
    },
    {
      title: 'Quyền hạn',
      dataIndex: 'privilege',
      width: 140,
      filters: Object.entries(PRIVILEGE_LABELS).map(([k, v]) => ({ text: v, value: Number(k) })),
      onFilter: (value, r) => r.privilege === value,
      render: v => (
        <Tag color={PRIVILEGE_COLORS[v] || 'default'}>
          {PRIVILEGE_LABELS[v] || `Quyền ${v}`}
        </Tag>
      ),
    },
    {
      title: 'Phòng ban',
      key: 'department',
      filters: departmentFilters,
      onFilter: (value, r) => (r.linked_department || r.department) === value,
      sorter: (a, b) => (a.linked_department || a.department || '').localeCompare(b.linked_department || b.department || '', 'vi'),
      render: (_, r) => r.linked_department || r.department || <Text type="secondary">—</Text>,
    },
    {
      title: 'Tài khoản',
      dataIndex: 'linked_username',
      width: 120,
      render: v => v ? <Tag color="green">{v}</Tag> : <Text type="secondary">Chưa map</Text>,
    },
    {
      title: 'Nhóm',
      dataIndex: 'group_id',
      width: 80,
      render: v => v || <Text type="secondary">—</Text>,
    },
    {
      title: 'Thẻ từ',
      dataIndex: 'card',
      width: 120,
      render: v => v && v !== 0
        ? <Tag color="geekblue">{v}</Tag>
        : <Text type="secondary">—</Text>,
    },
    {
      title: 'Đồng bộ lúc',
      dataIndex: 'synced_at',
      width: 160,
      sorter: (a, b) => (a.synced_at || '').localeCompare(b.synced_at || ''),
      render: v => v ? new Date(v).toLocaleString('vi-VN') : '—',
    },
    {
      title: 'Ca',
      dataIndex: 'shift_name',
      width: 120,
      filters: shifts.map(s => ({ text: s.name, value: s.name })),
      onFilter: (value, r) => r.shift_name === value,
      render: v => v ? <Tag color="purple">{v}</Tag> : <Text type="secondary">Chưa gán</Text>,
    },
    {
      title: 'Hiển thị',
      dataIndex: 'is_active',
      width: 90,
      align: 'center',
      filters: [{ text: 'Đang hiện', value: true }, { text: 'Đã ẩn', value: false }],
      defaultFilteredValue: [true],
      filterMultiple: false,
      onFilter: (value, r) => r.is_active === value,
      render: (v, r) => (
        <Switch
          checked={v}
          size="small"
          onChange={() => handleToggleActive(r)}
        />
      ),
    },
  ];

  return (
    <Card
      title={<Text strong>Danh sách nhân viên ({filtered.length})</Text>}
      bordered={false}
      extra={
        <Space>
          <Input
            placeholder="Tìm kiếm..."
            prefix={<SearchOutlined />}
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: 220 }}
            allowClear
          />
          <Button
            type="primary"
            icon={<SyncOutlined spin={syncing} />}
            onClick={handleSync}
            loading={syncing}
          >
            Đồng bộ từ máy
          </Button>
        </Space>
      }
    >
      {selectedRowKeys.length > 0 && (
        <Space style={{ marginBottom: 12 }}>
          <Text type="secondary">
            Đã chọn {selectedRowKeys.length} nhân viên
          </Text>
          <Button
            icon={<EyeOutlined />}
            loading={bulkLoading}
            onClick={() => handleBulkToggle(true)}
          >
            Hiện
          </Button>
          <Button
            icon={<EyeInvisibleOutlined />}
            loading={bulkLoading}
            onClick={() => handleBulkToggle(false)}
          >
            Ẩn
          </Button>
          <Button type="link" onClick={() => setSelectedRowKeys([])}>Bỏ chọn</Button>
          <Select
            placeholder="Gán ca..."
            style={{ width: 160 }}
            allowClear
            loading={bulkLoading}
            onChange={v => handleBulkAssignShift(v ?? null)}
            options={[
              { value: null, label: 'Bỏ gán ca' },
              ...shifts.map(s => ({ value: s.id, label: s.name })),
            ]}
          />
        </Space>
      )}
      <Table
        columns={columns}
        dataSource={filtered}
        rowKey="uid"
        rowSelection={{
          selectedRowKeys,
          onChange: setSelectedRowKeys,
        }}
        loading={loading}
        size="middle"
        pagination={{ pageSize: 20, showTotal: t => `Tổng ${t} nhân viên` }}
        scroll={{ x: 700 }}
      />
    </Card>
  );
}
