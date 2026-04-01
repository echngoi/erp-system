import { useEffect, useState } from 'react';
import {
  Card, Row, Col, Statistic, Typography, Space, Tag, Spin, Alert, Button
} from 'antd';
import {
  UserOutlined, CheckCircleOutlined, CalendarOutlined,
  ClockCircleOutlined, SyncOutlined, ThunderboltOutlined,
  DatabaseOutlined, ScanOutlined, IdcardOutlined
} from '@ant-design/icons';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell
} from 'recharts';
import { getDashboardStats, getDeviceStatus, syncAttendance } from '../../services/attendanceApi';

const { Title, Text } = Typography;

const COLORS = ['#1677ff', '#52c41a', '#faad14', '#f5222d', '#722ed1', '#13c2c2', '#fa541c'];

export default function AttendanceDashboard() {
  const [stats, setStats]         = useState(null);
  const [device, setDevice]       = useState(null);
  const [loading, setLoading]     = useState(true);
  const [syncing, setSyncing]     = useState(false);
  const [error, setError]         = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, d] = await Promise.all([getDashboardStats(), getDeviceStatus()]);
      setStats(s.data);
      setDevice(d.data);
    } catch {
      setError('Không thể tải dữ liệu. Vui lòng kiểm tra kết nối máy chủ.');
    } finally {
      setLoading(false);
    }
  };

  const handleQuickSync = async () => {
    setSyncing(true);
    try {
      await syncAttendance();
      await load();
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading) return (
    <div style={{ textAlign: 'center', padding: 80 }}>
      <Spin size="large" />
    </div>
  );

  if (error) return <Alert type="error" message={error} showIcon action={
    <Button size="small" onClick={load}>Thử lại</Button>
  } />;

  const isOnline = device?.status === 'connected';
  const isWaiting = device?.status === 'waiting';

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Row justify="space-between" align="middle">
        <Col>
          <Title level={3} style={{ margin: 0 }}>Tổng quan chấm công</Title>
          <Text type="secondary">
            Cập nhật lần cuối: {stats?.last_sync || 'Chưa đồng bộ'}
          </Text>
        </Col>
        <Col>
          <Space>
            <Tag
              icon={isOnline ? <CheckCircleOutlined /> : <ClockCircleOutlined />}
              color={isOnline ? 'success' : isWaiting ? 'warning' : 'error'}
              style={{ fontSize: 13, padding: '4px 12px' }}
            >
              Thiết bị: {isOnline ? 'Online' : isWaiting ? 'Chờ kết nối' : 'Offline'}
            </Tag>
            <Button
              type="primary"
              icon={<SyncOutlined spin={syncing} />}
              onClick={handleQuickSync}
              loading={syncing}
            >
              Đồng bộ nhanh
            </Button>
          </Space>
        </Col>
      </Row>

      {isOnline && (
        <Card bordered={false} size="small" style={{ background: '#f6ffed', border: '1px solid #b7eb8f' }}>
          <Row gutter={[16, 8]} align="middle">
            <Col flex="auto">
              <Space size="large" wrap>
                <span><ThunderboltOutlined style={{ color: '#52c41a' }} /> <b>{device.device_name || 'Ronald Jack AI06F'}</b></span>
                <span>IP: <Text code>{device.device_ip || device.ip}</Text></span>
                {device.serial_number && <span>S/N: <Text code>{device.serial_number}</Text></span>}
                {device.firmware && <span>FW: <Text code>{device.firmware}</Text></span>}
                {device.last_push && <span>Push cuối: <b>{device.last_push}</b></span>}
              </Space>
            </Col>
          </Row>
          {device.device_stats && (
            <Row gutter={16} style={{ marginTop: 12 }}>
              {[
                { label: 'Users trên máy', value: device.device_stats.total_users, icon: <UserOutlined />, color: '#1677ff' },
                { label: 'Khuôn mặt', value: device.device_stats.total_faces, icon: <ScanOutlined />, color: '#722ed1' },
                { label: 'Vân tay', value: device.device_stats.total_fingerprints, icon: <IdcardOutlined />, color: '#fa541c' },
                { label: 'Log trên máy', value: device.device_stats.total_logs?.toLocaleString(), icon: <DatabaseOutlined />, color: '#13c2c2' },
                { label: 'Log mới', value: device.device_stats.new_logs, icon: <SyncOutlined />, color: '#faad14' },
              ].map((s, i) => (
                <Col key={i}>
                  <Space size={4}>
                    {s.icon}
                    <Text type="secondary" style={{ fontSize: 12 }}>{s.label}:</Text>
                    <Text strong>{s.value ?? 0}</Text>
                  </Space>
                </Col>
              ))}
            </Row>
          )}
        </Card>
      )}
      {isWaiting && (
        <Alert
          type="warning"
          showIcon
          icon={<ClockCircleOutlined />}
          message="Đang chờ máy chấm công kết nối..."
          description={device?.note}
        />
      )}

      <Row gutter={[16, 16]}>
        {[
          { title: 'Tổng nhân viên', value: stats?.total_employees, icon: <UserOutlined />, color: '#1677ff' },
          { title: 'Có mặt hôm nay', value: stats?.active_today, icon: <CheckCircleOutlined />, color: '#52c41a' },
          { title: 'Chấm công hôm nay', value: stats?.today_checkins, icon: <ClockCircleOutlined />, color: '#faad14' },
          { title: 'Tuần này', value: stats?.week_checkins, icon: <CalendarOutlined />, color: '#722ed1' },
          { title: 'Tháng này', value: stats?.month_checkins, icon: <CalendarOutlined />, color: '#13c2c2' },
        ].map((item, i) => (
          <Col xs={24} sm={12} lg={6} xl={5} key={i} style={{ flex: 1 }}>
            <Card
              bordered={false}
              style={{
                background: `linear-gradient(135deg, ${item.color}15, ${item.color}05)`,
                border: `1px solid ${item.color}30`,
              }}
            >
              <Statistic
                title={<Text style={{ fontSize: 13 }}>{item.title}</Text>}
                value={item.value ?? 0}
                prefix={item.icon}
                valueStyle={{ color: item.color, fontWeight: 700 }}
              />
            </Card>
          </Col>
        ))}
      </Row>

      <Card title="Chấm công 7 ngày gần nhất" bordered={false}>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={stats?.daily_stats || []} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 13 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 13 }} />
            <Tooltip
              formatter={(v) => [`${v} lượt`, 'Chấm công']}
              contentStyle={{ borderRadius: 8 }}
            />
            <Bar dataKey="count" radius={[6, 6, 0, 0]}>
              {(stats?.daily_stats || []).map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </Space>
  );
}
