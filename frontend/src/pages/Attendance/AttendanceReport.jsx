import { useState, useEffect, useCallback } from 'react';
import {
  Card, Table, DatePicker, Select, Button, Row, Col, Statistic, Tag, Space,
  Typography, message, Tooltip, Tabs, Spin,
} from 'antd';
import {
  FileExcelOutlined, SearchOutlined, ClockCircleOutlined,
  WarningOutlined, CheckCircleOutlined, CloseCircleOutlined,
  FieldTimeOutlined, DollarOutlined, ExclamationCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { getAttendanceReport, exportAttendanceReport, getEmployees } from '../../services/attendanceApi';

const { RangePicker } = DatePicker;
const { Title, Text } = Typography;

const STATUS_MAP = {
  present:     { color: 'green',   text: 'Đúng giờ',   icon: <CheckCircleOutlined /> },
  late:        { color: 'orange',  text: 'Đi muộn',    icon: <WarningOutlined /> },
  early:       { color: 'blue',    text: 'Về sớm',     icon: <ClockCircleOutlined /> },
  'late+early':{ color: 'volcano', text: 'Muộn+Sớm',   icon: <WarningOutlined /> },
  absent:      { color: 'red',     text: 'Vắng mặt',   icon: <CloseCircleOutlined /> },
};

export default function AttendanceReport() {
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reportData, setReportData] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [dateRange, setDateRange] = useState([
    dayjs().startOf('month'),
    dayjs(),
  ]);
  const [selectedUser, setSelectedUser] = useState(null);

  useEffect(() => {
    getEmployees().then(res => setEmployees(res.data.results || [])).catch(() => {});
  }, []);

  const fetchReport = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        date_from: dateRange[0].format('YYYY-MM-DD'),
        date_to:   dateRange[1].format('YYYY-MM-DD'),
      };
      if (selectedUser) params.user_id = selectedUser;
      const res = await getAttendanceReport({ ...params, _page: 'report' });
      setReportData(res.data);
    } catch (err) {
      message.error('Không thể tải báo cáo');
    } finally {
      setLoading(false);
    }
  }, [dateRange, selectedUser]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = {
        date_from: dateRange[0].format('YYYY-MM-DD'),
        date_to:   dateRange[1].format('YYYY-MM-DD'),
      };
      if (selectedUser) params.user_id = selectedUser;
      const res = await exportAttendanceReport({ ...params, _page: 'report' });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `BaoCaoChamCong_${params.date_from}_${params.date_to}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      message.success('Xuất Excel thành công');
    } catch {
      message.error('Xuất Excel thất bại');
    } finally {
      setExporting(false);
    }
  };

  // ── Summary columns ──
  const summaryColumns = [
    {
      title: 'STT', width: 60, align: 'center',
      render: (_, __, i) => i + 1,
    },
    { title: 'Mã NV', width: 100,
      render: (_, r) => r.username || r.user_id,
    },
    { title: 'Họ tên', dataIndex: 'employee_name', width: 180,
      render: v => <Text strong>{v}</Text>,
    },
    { title: 'Phòng ban', dataIndex: 'department', width: 140 },
    {
      title: 'Đi làm', width: 80, align: 'center',
      render: (_, r) => <Text type="success">{r.summary.present}</Text>,
    },
    {
      title: 'Đi muộn', width: 90, align: 'center',
      render: (_, r) => r.summary.late > 0
        ? <Tag color="orange">{r.summary.late}</Tag>
        : <Text type="secondary">0</Text>,
    },
    {
      title: 'Về sớm', width: 90, align: 'center',
      render: (_, r) => r.summary.early_leave > 0
        ? <Tag color="blue">{r.summary.early_leave}</Tag>
        : <Text type="secondary">0</Text>,
    },
    {
      title: 'Vắng', width: 80, align: 'center',
      render: (_, r) => r.summary.absent > 0
        ? <Tag color="red">{r.summary.absent}</Tag>
        : <Text type="secondary">0</Text>,
    },
    {
      title: 'OT (giờ)', width: 90, align: 'center',
      render: (_, r) => r.summary.ot_hours > 0
        ? <Tag color="purple">{r.summary.ot_hours}</Tag>
        : <Text type="secondary">0</Text>,
    },
    {
      title: 'Giờ làm', width: 90, align: 'center',
      render: (_, r) => <Text>{r.summary.work_hours}</Text>,
    },
    {
      title: 'Phạt muộn', width: 110, align: 'right',
      render: (_, r) => r.summary.late_penalty > 0
        ? <Text type="danger">{r.summary.late_penalty.toLocaleString('vi-VN')}₫</Text>
        : <Text type="secondary">—</Text>,
    },
    {
      title: 'Phạt sớm', width: 110, align: 'right',
      render: (_, r) => r.summary.early_penalty > 0
        ? <Text type="danger">{r.summary.early_penalty.toLocaleString('vi-VN')}₫</Text>
        : <Text type="secondary">—</Text>,
    },
    {
      title: 'Tổng phạt', width: 120, align: 'right',
      render: (_, r) => r.summary.total_penalty > 0
        ? <Text strong type="danger">{r.summary.total_penalty.toLocaleString('vi-VN')}₫</Text>
        : <Text type="secondary">—</Text>,
    },
  ];

  // ── Daily detail columns ──
  const dailyData = reportData
    ? reportData.employees.flatMap(emp =>
        emp.daily.map(d => ({ ...d, user_id: emp.user_id, username: emp.username, employee_name: emp.employee_name }))
      )
    : [];

  const dailyColumns = [
    { title: 'Mã NV', width: 90,
      render: (_, r) => r.username || r.user_id,
    },
    { title: 'Họ tên', dataIndex: 'employee_name', width: 160 },
    { title: 'Ngày', dataIndex: 'date', width: 110,
      render: v => dayjs(v).format('DD/MM/YYYY'),
    },
    { title: 'Check-in', dataIndex: 'check_in', width: 90, align: 'center',
      render: v => v || '—',
    },
    { title: 'Check-out', dataIndex: 'check_out', width: 90, align: 'center',
      render: v => v || '—',
    },
    {
      title: 'Trạng thái', dataIndex: 'status', width: 120, align: 'center',
      render: v => {
        const s = STATUS_MAP[v] || { color: 'default', text: v };
        return <Tag color={s.color} icon={s.icon}>{s.text}</Tag>;
      },
    },
    { title: 'Muộn (phút)', dataIndex: 'late_minutes', width: 100, align: 'center',
      render: v => v > 0 ? <Text type="warning">{v}</Text> : '—',
    },
    { title: 'Sớm (phút)', dataIndex: 'early_minutes', width: 100, align: 'center',
      render: v => v > 0 ? <Text type="warning">{v}</Text> : '—',
    },
    { title: 'OT (phút)', dataIndex: 'ot_minutes', width: 90, align: 'center',
      render: v => v > 0 ? <Text style={{ color: '#722ed1' }}>{v}</Text> : '—',
    },
    { title: 'Làm (phút)', dataIndex: 'work_minutes', width: 100, align: 'center',
      render: v => v > 0 ? v : '—',
    },
  ];

  // ── Late/early detail data ──
  const lateEarlyData = reportData
    ? reportData.employees.flatMap(emp =>
        emp.daily.filter(d => d.late_minutes > 0 || d.early_minutes > 0).map(d => {
          const punches = d.punches || [];
          return {
            key: `${emp.user_id}_${d.date}`,
            user_id: emp.user_id,
            username: emp.username,
            employee_name: emp.employee_name,
            department: emp.department,
            date: d.date,
            check_in: punches[0] || d.check_in,
            check_out: punches.length > 1 ? punches[punches.length - 1] : d.check_out,
            late_minutes: d.late_minutes,
            late_label: d.late_label || '',
            early_minutes: d.early_minutes,
            early_label: d.early_label || '',
          };
        })
      )
    : [];

  const lateEarlyCols = [
    { title: 'Mã NV', width: 90, render: (_, r) => r.username || r.user_id },
    { title: 'Họ tên', dataIndex: 'employee_name', width: 160 },
    { title: 'Phòng ban', dataIndex: 'department', width: 140 },
    { title: 'Ngày', dataIndex: 'date', width: 110, render: v => dayjs(v).format('DD/MM/YYYY') },
    { title: 'Check-in', dataIndex: 'check_in', width: 90, align: 'center', render: v => v || '—' },
    { title: 'Check-out', dataIndex: 'check_out', width: 90, align: 'center', render: v => v || '—' },
    {
      title: 'Đi muộn', width: 120, align: 'center',
      render: (_, r) => r.late_minutes > 0
        ? <Tooltip title={r.late_label}><Tag color="orange">{r.late_minutes} phút</Tag></Tooltip>
        : '—',
    },
    {
      title: 'Về sớm', width: 120, align: 'center',
      render: (_, r) => r.early_minutes > 0
        ? <Tooltip title={r.early_label}><Tag color="blue">{r.early_minutes} phút</Tag></Tooltip>
        : '—',
    },
  ];

  // ── Missing punches data ──
  const missingPunchData = reportData
    ? reportData.employees.flatMap(emp =>
        emp.daily.filter(d => d.missing_punches?.length > 0).map(d => ({
          key: `${emp.user_id}_${d.date}`,
          user_id: emp.user_id,
          username: emp.username,
          employee_name: emp.employee_name,
          department: emp.department,
          date: d.date,
          check_in: d.check_in,
          check_out: d.check_out,
          missing: d.missing_punches.join(', '),
        }))
      )
    : [];

  const missingPunchCols = [
    { title: 'Mã NV', width: 90, render: (_, r) => r.username || r.user_id },
    { title: 'Họ tên', dataIndex: 'employee_name', width: 160 },
    { title: 'Phòng ban', dataIndex: 'department', width: 140 },
    { title: 'Ngày', dataIndex: 'date', width: 110, render: v => dayjs(v).format('DD/MM/YYYY') },
    { title: 'Check-in', dataIndex: 'check_in', width: 90, align: 'center', render: v => v || '—' },
    { title: 'Check-out', dataIndex: 'check_out', width: 90, align: 'center', render: v => v || '—' },
    { title: 'Thiếu chấm công', dataIndex: 'missing', width: 200,
      render: v => <Tag color="red">{v}</Tag>,
    },
  ];

  // ── Aggregate stats ──
  const stats = reportData ? reportData.employees.reduce(
    (acc, e) => ({
      totalPresent: acc.totalPresent + e.summary.present,
      totalLate:    acc.totalLate    + e.summary.late,
      totalEarly:   acc.totalEarly   + e.summary.early_leave,
      totalAbsent:  acc.totalAbsent  + e.summary.absent,
      totalOT:      acc.totalOT      + e.summary.ot_hours,
      totalPenalty:  acc.totalPenalty  + (e.summary.total_penalty || 0),
    }),
    { totalPresent: 0, totalLate: 0, totalEarly: 0, totalAbsent: 0, totalOT: 0, totalPenalty: 0 }
  ) : null;

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>
        <FieldTimeOutlined /> Báo cáo chấm công
      </Title>

      {/* Filters */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={[16, 12]} align="middle">
          <Col>
            <Text type="secondary" style={{ marginRight: 8 }}>Khoảng thời gian:</Text>
            <RangePicker
              value={dateRange}
              onChange={val => val && setDateRange(val)}
              format="DD/MM/YYYY"
              allowClear={false}
              presets={[
                { label: 'Hôm nay', value: [dayjs(), dayjs()] },
                { label: 'Tuần này', value: [dayjs().startOf('week'), dayjs()] },
                { label: 'Tháng này', value: [dayjs().startOf('month'), dayjs()] },
                { label: 'Tháng trước', value: [
                  dayjs().subtract(1, 'month').startOf('month'),
                  dayjs().subtract(1, 'month').endOf('month'),
                ]},
              ]}
            />
          </Col>
          <Col>
            <Text type="secondary" style={{ marginRight: 8 }}>Nhân viên:</Text>
            <Select
              allowClear
              placeholder="Tất cả nhân viên"
              style={{ width: 220 }}
              value={selectedUser}
              onChange={setSelectedUser}
              showSearch
              optionFilterProp="label"
              options={employees.map(e => ({ value: e.user_id, label: `${e.user_id} - ${e.display_name}` }))}
            />
          </Col>
          <Col>
            <Space>
              <Button type="primary" icon={<SearchOutlined />} onClick={fetchReport} loading={loading}>
                Xem báo cáo
              </Button>
              <Button icon={<FileExcelOutlined />} onClick={handleExport} loading={exporting}
                style={{ color: '#217346', borderColor: '#217346' }}>
                Xuất Excel
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {/* Stats cards */}
      {stats && (
        <Row gutter={16} style={{ marginBottom: 16 }}>
          <Col xs={12} sm={8} md={4}>
            <Card size="small"><Statistic title="Đi làm" value={stats.totalPresent}
              valueStyle={{ color: '#52c41a' }} prefix={<CheckCircleOutlined />} /></Card>
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Card size="small"><Statistic title="Đi muộn" value={stats.totalLate}
              valueStyle={{ color: '#fa8c16' }} prefix={<WarningOutlined />} /></Card>
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Card size="small"><Statistic title="Về sớm" value={stats.totalEarly}
              valueStyle={{ color: '#1890ff' }} prefix={<ClockCircleOutlined />} /></Card>
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Card size="small"><Statistic title="Vắng mặt" value={stats.totalAbsent}
              valueStyle={{ color: '#ff4d4f' }} prefix={<CloseCircleOutlined />} /></Card>
          </Col>
          <Col xs={12} sm={8} md={4}>
            <Card size="small"><Statistic title="Tăng ca (giờ)" value={stats.totalOT}
              valueStyle={{ color: '#722ed1' }} prefix={<FieldTimeOutlined />} /></Card>
          </Col>
          {stats.totalPenalty > 0 && (
            <Col xs={12} sm={8} md={4}>
              <Card size="small"><Statistic title="Tổng phạt" value={stats.totalPenalty}
                valueStyle={{ color: '#ff4d4f' }} prefix={<DollarOutlined />} suffix="₫" /></Card>
            </Col>
          )}
        </Row>
      )}

      {/* Report tables */}
      <Card size="small">
        <Tabs
          defaultActiveKey="summary"
          items={[
            {
              key: 'summary',
              label: 'Tổng hợp',
              children: (
                <Table
                  dataSource={reportData?.employees || []}
                  columns={summaryColumns}
                  rowKey="user_id"
                  loading={loading}
                  pagination={false}
                  scroll={{ x: 1000 }}
                  size="small"
                  bordered
                />
              ),
            },
            {
              key: 'daily',
              label: 'Chi tiết ngày',
              children: (
                <Table
                  dataSource={dailyData}
                  columns={dailyColumns}
                  rowKey={(r, i) => `${r.user_id}_${r.date}_${i}`}
                  loading={loading}
                  pagination={{ defaultPageSize: 50, showSizeChanger: true, showTotal: t => `Tổng: ${t} dòng` }}
                  scroll={{ x: 1100 }}
                  size="small"
                  bordered
                />
              ),
            },
            {
              key: 'late-early',
              label: <span><WarningOutlined /> Đi muộn / Về sớm ({lateEarlyData.length})</span>,
              children: (
                <Table
                  dataSource={lateEarlyData}
                  columns={lateEarlyCols}
                  rowKey="key"
                  loading={loading}
                  pagination={{ defaultPageSize: 50, showSizeChanger: true, showTotal: t => `Tổng: ${t} dòng` }}
                  scroll={{ x: 1000 }}
                  size="small"
                  bordered
                />
              ),
            },
            {
              key: 'missing-punch',
              label: <span><ExclamationCircleOutlined /> Thiếu chấm công ({missingPunchData.length})</span>,
              children: (
                <Table
                  dataSource={missingPunchData}
                  columns={missingPunchCols}
                  rowKey="key"
                  loading={loading}
                  pagination={{ defaultPageSize: 50, showSizeChanger: true, showTotal: t => `Tổng: ${t} dòng` }}
                  scroll={{ x: 900 }}
                  size="small"
                  bordered
                />
              ),
            },
          ]}
        />
      </Card>

      {reportData && (
        <div style={{ marginTop: 8, textAlign: 'right' }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Ca làm việc: {reportData.work_start} – {reportData.work_end} ·
            Tổng nhân viên: {reportData.total_employees}
          </Text>
        </div>
      )}
    </div>
  );
}
