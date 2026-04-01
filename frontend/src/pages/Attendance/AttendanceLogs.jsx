import { useEffect, useState, useCallback } from 'react';
import {
  Table, Card, Row, Col, DatePicker, Select, Button,
  Space, Tag, Typography, Input, message, Popconfirm, Tooltip
} from 'antd';
import {
  SyncOutlined, DeleteOutlined, ReloadOutlined,
  DownloadOutlined, SearchOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { getAttendance, syncAttendance, clearAttendance, getEmployees } from '../../services/attendanceApi';

const { RangePicker } = DatePicker;
const { Text } = Typography;
const { Option } = Select;

const PUNCH_COLORS = {
  0: 'green', 1: 'red', 2: 'orange',
  3: 'blue', 4: 'purple', 5: 'volcano',
};
const PUNCH_LABELS = {
  0: 'Vào ca', 1: 'Ra ca', 2: 'Nghỉ giải lao',
  3: 'Trở lại', 4: 'Tăng ca vào', 5: 'Tăng ca ra',
};

export default function AttendancePage() {
  const [data, setData]         = useState([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(false);
  const [syncing, setSyncing]   = useState(false);
  const [employees, setEmployees] = useState([]);
  const [filters, setFilters]   = useState({
    page: 1, page_size: 50,
    date_from: dayjs().startOf('month').format('YYYY-MM-DD'),
    date_to:   dayjs().format('YYYY-MM-DD'),
    user_id: undefined,
    punch: undefined,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      Object.entries(filters).forEach(([k, v]) => { if (v !== undefined && v !== '') params[k] = v; });
      const res = await getAttendance(params);
      setData(res.data.results);
      setTotal(res.data.total);
    } catch {
      message.error('Lỗi tải dữ liệu chấm công');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    getEmployees().then(r => setEmployees(r.data.results)).catch(() => {});
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await syncAttendance();
      message.success(res.data.message);
      load();
    } catch (e) {
      message.error(e.response?.data?.error || 'Lỗi đồng bộ');
    } finally {
      setSyncing(false);
    }
  };

  const handleClear = async () => {
    try {
      await clearAttendance();
      message.success('Đã xóa dữ liệu chấm công trên thiết bị');
    } catch (e) {
      message.error(e.response?.data?.error || 'Lỗi xóa dữ liệu');
    }
  };

  const exportCSV = () => {
    const headers = ['Mã NV', 'Tên nhân viên', 'Phòng ban', 'Thời gian', 'Loại chấm công', 'Trạng thái'];
    const rows = data.map(r => [
      r.employee_username || r.user_id,
      r.employee_name || '',
      r.employee_department || '',
      r.timestamp,
      PUNCH_LABELS[r.punch] || r.punch,
      r.status,
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url;
    a.download = `chamcong_${dayjs().format('YYYYMMDD')}.csv`;
    a.click();
  };

  const columns = [
    {
      title: 'Mã NV',
      key: 'employee_code',
      width: 90,
      render: (_, r) => <Text strong>{r.employee_username || r.user_id}</Text>,
    },
    {
      title: 'Tên nhân viên',
      dataIndex: 'employee_name',
      ellipsis: true,
      render: v => v || <Text type="secondary">—</Text>,
    },
    {
      title: 'Phòng ban',
      dataIndex: 'employee_department',
      width: 130,
      ellipsis: true,
      render: v => v || <Text type="secondary">—</Text>,
    },
    {
      title: 'Thời gian',
      dataIndex: 'timestamp',
      sorter: (a, b) => a.timestamp?.localeCompare(b.timestamp),
      render: v => (
        <Space direction="vertical" size={0}>
          <Text strong>{dayjs(v).format('DD/MM/YYYY')}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>{dayjs(v).format('HH:mm:ss')}</Text>
        </Space>
      ),
    },
    {
      title: 'Loại chấm công',
      dataIndex: 'punch',
      width: 140,
      render: v => (
        <Tag color={PUNCH_COLORS[v] || 'default'}>
          {PUNCH_LABELS[v] || `Loại ${v}`}
        </Tag>
      ),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'status',
      width: 90,
      render: v => <Tag>{v}</Tag>,
    },
  ];

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {/* Filters */}
      <Card bordered={false}>
        <Row gutter={[12, 12]} align="middle">
          <Col>
            <RangePicker
              value={[
                filters.date_from ? dayjs(filters.date_from) : null,
                filters.date_to   ? dayjs(filters.date_to)   : null,
              ]}
              onChange={dates => setFilters(f => ({
                ...f,
                date_from: dates?.[0]?.format('YYYY-MM-DD'),
                date_to:   dates?.[1]?.format('YYYY-MM-DD'),
                page: 1,
              }))}
              format="DD/MM/YYYY"
            />
          </Col>
          <Col>
            <Select
              placeholder="Nhân viên"
              allowClear
              showSearch
              style={{ width: 200 }}
              filterOption={(input, opt) =>
                opt.label?.toLowerCase().includes(input.toLowerCase())
              }
              onChange={v => setFilters(f => ({ ...f, user_id: v, page: 1 }))}
              options={employees.map(e => ({
                value: e.user_id, label: `${e.user_id} - ${e.display_name}`
              }))}
            />
          </Col>
          <Col>
            <Select
              placeholder="Loại chấm công"
              allowClear
              style={{ width: 160 }}
              onChange={v => setFilters(f => ({ ...f, punch: v, page: 1 }))}
            >
              {Object.entries(PUNCH_LABELS).map(([k, v]) => (
                <Option key={k} value={Number(k)}>
                  <Tag color={PUNCH_COLORS[k]}>{v}</Tag>
                </Option>
              ))}
            </Select>
          </Col>
          <Col>
            <Button icon={<SearchOutlined />} type="primary" onClick={load}>
              Tìm kiếm
            </Button>
          </Col>
        </Row>
      </Card>

      {/* Table */}
      <Card
        title={<Text strong>Lịch sử chấm công ({total} bản ghi)</Text>}
        bordered={false}
        extra={
          <Space>
            <Tooltip title="Đồng bộ từ máy">
              <Button icon={<SyncOutlined spin={syncing} />} onClick={handleSync} loading={syncing} type="primary">
                Đồng bộ
              </Button>
            </Tooltip>
            <Button icon={<DownloadOutlined />} onClick={exportCSV}>Xuất CSV</Button>
            <Popconfirm
              title="Xóa toàn bộ dữ liệu trên máy chấm công?"
              description="Hành động này không thể hoàn tác."
              onConfirm={handleClear}
              okText="Xóa" cancelText="Hủy" okButtonProps={{ danger: true }}
            >
              <Button icon={<DeleteOutlined />} danger>Xóa máy</Button>
            </Popconfirm>
            <Button icon={<ReloadOutlined />} onClick={load}>Làm mới</Button>
          </Space>
        }
      >
        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          size="middle"
          pagination={{
            current: filters.page,
            pageSize: filters.page_size,
            total,
            showSizeChanger: true,
            showTotal: (t) => `Tổng ${t} bản ghi`,
            pageSizeOptions: ['20', '50', '100'],
            onChange: (page, page_size) => setFilters(f => ({ ...f, page, page_size })),
          }}
          scroll={{ x: 600 }}
        />
      </Card>
    </Space>
  );
}
