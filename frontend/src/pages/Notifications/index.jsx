import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  Empty,
  List,
  Segmented,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  BellOutlined,
  CheckCircleOutlined,
  FileTextOutlined,
  MailOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';

const { Text, Title } = Typography;

function normalizeList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.results)) return payload.results;
  return [];
}

function getTypeMeta(type) {
  if (type === 'REQUEST') {
    return {
      icon: <FileTextOutlined style={{ color: '#1677ff' }} />,
      label: 'Yêu cầu',
    };
  }

  if (type === 'MESSAGE') {
    return {
      icon: <MailOutlined style={{ color: '#13c2c2' }} />,
      label: 'Tin nhắn',
    };
  }

  if (type === 'APPROVAL') {
    return {
      icon: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
      label: 'Phê duyệt',
    };
  }

  return {
    icon: <BellOutlined style={{ color: '#999' }} />,
    label: type || 'Khác',
  };
}

function getNotificationPath(type) {
  if (type === 'REQUEST') return '/request';
  if (type === 'MESSAGE') return '/inbox';
  if (type === 'APPROVAL') return '/approval';
  return '/request';
}

export default function NotificationsPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState([]);
  const [filterMode, setFilterMode] = useState('all');
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 12,
    total: 0,
    hasNext: false,
  });

  const unreadCountInPage = useMemo(
    () => items.filter((item) => !item.is_read).length,
    [items],
  );

  const loadNotifications = useCallback(async ({ page = 1, mode = filterMode } = {}) => {
    setLoading(true);
    try {
      const params = { page, page_size: pagination.pageSize };
      if (mode === 'unread') {
        params.unread = true;
      }

      const response = await api.get('/notifications/', { params });
      const list = normalizeList(response.data);
      setItems(list);
      setPagination((prev) => ({
        ...prev,
        current: page,
        total: typeof response.data?.count === 'number' ? response.data.count : list.length,
        hasNext: Boolean(response.data?.next),
      }));
    } catch {
      message.error('Không thể tải danh sách thông báo');
    } finally {
      setLoading(false);
    }
  }, [filterMode, pagination.pageSize]);

  useEffect(() => {
    loadNotifications({ page: 1, mode: filterMode });
  }, [filterMode, loadNotifications]);

  const markRead = async (notification) => {
    if (notification.is_read) return;

    try {
      await api.post(`/notifications/${notification.id}/mark_read/`);
      setItems((prev) =>
        prev.map((item) =>
          item.id === notification.id
            ? { ...item, is_read: true }
            : item,
        ),
      );
    } catch {
      message.error('Không thể cập nhật thông báo');
    }
  };

  const markAllRead = async () => {
    try {
      await api.post('/notifications/mark_all_read/');
      setItems((prev) => prev.map((item) => ({ ...item, is_read: true })));
      message.success('Đã đánh dấu tất cả là đã đọc');
      if (filterMode === 'unread') {
        loadNotifications({ page: 1, mode: 'unread' });
      }
    } catch {
      message.error('Không thể đánh dấu tất cả thông báo');
    }
  };

  const openNotificationTarget = async (item) => {
    if (!item.is_read) {
      await markRead(item);
    }
    navigate(getNotificationPath(item.type));
  };

  const handleFilterChange = (value) => {
    setFilterMode(value);
    setPagination((prev) => ({ ...prev, current: 1 }));
  };

  return (
    <Card>
      <Space
        style={{
          width: '100%',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
        }}
      >
        <div>
          <Title level={4} style={{ margin: 0 }}>Thông báo</Title>
          <Text type="secondary">Danh sách hiển thị ưu tiên thông báo chưa đọc trước.</Text>
        </div>
        <Space>
          <Segmented
            value={filterMode}
            onChange={handleFilterChange}
            options={[
              { label: 'Tất cả', value: 'all' },
              { label: 'Chưa đọc', value: 'unread' },
            ]}
          />
          <Button onClick={markAllRead} disabled={unreadCountInPage === 0 && filterMode === 'unread'}>
            Đánh dấu tất cả đã đọc
          </Button>
        </Space>
      </Space>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 32 }}>
          <Spin />
        </div>
      ) : items.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có thông báo" />
      ) : (
        <List
          itemLayout="horizontal"
          dataSource={items}
          pagination={{
            current: pagination.current,
            total: pagination.total,
            pageSize: pagination.pageSize,
            showSizeChanger: true,
            pageSizeOptions: [8, 12, 20, 30],
            onChange: (page, pageSize) => {
              setPagination((prev) => ({ ...prev, pageSize, current: page }));
              loadNotifications({ page, mode: filterMode });
            },
          }}
          renderItem={(item) => {
            const meta = getTypeMeta(item.type);
            return (
              <List.Item
                onClick={() => openNotificationTarget(item)}
                style={{
                  cursor: 'pointer',
                  borderRadius: 8,
                  marginBottom: 8,
                  paddingInline: 12,
                  background: item.is_read ? '#fff' : '#f6ffed',
                  borderLeft: item.is_read ? '4px solid transparent' : '4px solid #52c41a',
                }}
                actions={[
                  <Button
                    key="mark-read"
                    type="link"
                    size="small"
                    onClick={(event) => {
                      event.stopPropagation();
                      markRead(item);
                    }}
                    disabled={item.is_read}
                  >
                    Đánh dấu đã đọc
                  </Button>,
                ]}
              >
                <List.Item.Meta
                  avatar={meta.icon}
                  title={
                    <Space>
                      <Text strong={!item.is_read}>{item.content}</Text>
                      <Tag color="default">{meta.label}</Tag>
                    </Space>
                  }
                  description={
                    <Text type="secondary" strong={!item.is_read}>
                      {dayjs(item.created_at).format('DD/MM/YYYY HH:mm')}
                    </Text>
                  }
                />
              </List.Item>
            );
          }}
        />
      )}
    </Card>
  );
}
