import { useEffect, useMemo, useState } from 'react';
import { Row, Col, Typography, Space, Alert, Button } from 'antd';
import {
  FileTextOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  MailOutlined,
  PlusOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import StatCard from './StatCard';
import api from '../../services/api';

const { Title, Text } = Typography;

const STATS = [
  {
    key: 'totalRequests',
    title: 'Tổng số yêu cầu',
    icon: <FileTextOutlined />,
    color: '#1677ff',
    tone: 'ocean',
    helper: 'Hôm nay',
    secondaryLabel: 'Tổng',
  },
  {
    key: 'inProgress',
    title: 'Task đang xử lý',
    icon: <ClockCircleOutlined />,
    color: '#fa8c16',
    tone: 'amber',
    fetch: () => api.get('/requests/', { params: { type: 'TASK', status: 'IN_PROGRESS' } }),
  },
  {
    key: 'pendingApprovals',
    title: 'Cần phê duyệt',
    icon: <CheckCircleOutlined />,
    color: '#52c41a',
    tone: 'emerald',
    helper: 'Chờ xử lý',
    secondaryLabel: 'Đã phê duyệt',
  },
  {
    key: 'unreadMessages',
    title: 'Tin nhắn chưa đọc',
    icon: <MailOutlined />,
    color: '#722ed1',
    tone: 'violet',
    fetch: () => api.get('/messages/inbox/', { params: { unread: true } }),
  },
];

const getCount = (data) => {
  if (data !== null && typeof data === 'object' && 'count' in data) return data.count;
  if (Array.isArray(data)) return data.length;
  return 0;
};

const INITIAL_STATS = {
  totalRequests: { value: 0, secondaryValue: 0 },
  inProgress: { value: 0 },
  pendingApprovals: { value: 0, secondaryValue: 0 },
  unreadMessages: { value: 0 },
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const [stats, setStats] = useState(INITIAL_STATS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const quickActions = useMemo(
    () => [
      {
        key: 'create-request',
        label: 'Mở trang yêu cầu',
        icon: <PlusOutlined />,
        onClick: () => navigate('/request'),
      },
      {
        key: 'approvals',
        label: 'Xem phê duyệt',
        icon: <CheckCircleOutlined />,
        onClick: () => navigate('/approval'),
      },
      {
        key: 'compose-message',
        label: 'Soạn tin nhắn',
        icon: <SendOutlined />,
        onClick: () => navigate('/messages/compose'),
      },
      {
        key: 'inbox',
        label: 'Mở hộp thư',
        icon: <MailOutlined />,
        onClick: () => navigate('/inbox'),
      },
    ],
    [navigate],
  );

  useEffect(() => {
    let cancelled = false;

    const fetchAll = async () => {
      setLoading(true);
      setError(false);

      const [
        todayRequestsResult,
        totalRequestsResult,
        inProgressResult,
        pendingApprovalsResult,
        approvedApprovalsResult,
        unreadMessagesResult,
      ] = await Promise.allSettled([
        api.get('/requests/', { params: { type: 'TASK', created_today: '1' } }),
        api.get('/requests/', { params: { type: 'TASK' } }),
        api.get('/requests/', { params: { type: 'TASK', status: 'IN_PROGRESS' } }),
        api.get('/approvals/', { params: { status: 'PENDING' } }),
        api.get('/requests/', { params: { type: 'APPROVAL', status: 'APPROVED' } }),
        api.get('/messages/inbox/', { params: { unread: true } }),
      ]);

      if (cancelled) return;

      const results = [
        todayRequestsResult,
        totalRequestsResult,
        inProgressResult,
        pendingApprovalsResult,
        approvedApprovalsResult,
        unreadMessagesResult,
      ];

      const allFailed = results.every((r) => r.status === 'rejected');
      if (allFailed) {
        setError(true);
        setLoading(false);
        return;
      }

      const getResultCount = (result) => (result.status === 'fulfilled' ? getCount(result.value.data) : 0);

      const updated = {
        totalRequests: {
          value: getResultCount(todayRequestsResult),
          secondaryValue: getResultCount(totalRequestsResult),
        },
        inProgress: {
          value: getResultCount(inProgressResult),
        },
        pendingApprovals: {
          value: getResultCount(pendingApprovalsResult),
          secondaryValue: getResultCount(approvedApprovalsResult),
        },
        unreadMessages: {
          value: getResultCount(unreadMessagesResult),
        },
      };

      setStats(updated);
      setLoading(false);
    };

    fetchAll();
    return () => { cancelled = true; };
  }, []);

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <div className="dashboard-overview-heading">
        <Title level={4} style={{ margin: 0 }}>Tổng quan</Title>
        <Text type="secondary">Thống kê hoạt động trong hệ thống</Text>
      </div>

      <div className="dashboard-quick-actions">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <Title level={5} style={{ margin: 0 }}>Thao tác nhanh</Title>
            <Text type="secondary">Đi tới các khu vực thường dùng chỉ với một lần bấm</Text>
          </div>

          <Space wrap size={12}>
            {quickActions.map((action) => (
              <Button
                key={action.key}
                className="dashboard-quick-action-btn"
                icon={action.icon}
                onClick={action.onClick}
              >
                {action.label}
              </Button>
            ))}
          </Space>
        </Space>
      </div>

      {error && (
        <Alert
          type="warning"
          message="Không thể tải dữ liệu thống kê. Vui lòng kiểm tra kết nối đến máy chủ."
          showIcon
          closable
        />
      )}

      <Row gutter={[18, 18]} className="dashboard-stat-grid">
        {STATS.map((config) => (
          <Col xs={24} sm={12} xl={6} key={config.key}>
            <StatCard
              tone={config.tone}
              title={config.title}
              value={stats[config.key]?.value ?? 0}
              icon={config.icon}
              color={config.color}
              loading={loading}
              helper={config.helper}
              secondaryLabel={config.secondaryLabel}
              secondaryValue={stats[config.key]?.secondaryValue ?? 0}
            />
          </Col>
        ))}
      </Row>
    </Space>
  );
}
