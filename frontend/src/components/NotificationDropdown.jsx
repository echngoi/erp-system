import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Divider,
  Dropdown,
  Empty,
  List,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  BellOutlined,
  CheckCircleOutlined,
  DownOutlined,
  FileTextOutlined,
  MailOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';

const { Text } = Typography;

function normalizeList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.results)) return payload.results;
  return [];
}

function normalizeCount(payload) {
  if (payload && typeof payload === 'object' && typeof payload.count === 'number') {
    return payload.count;
  }
  return normalizeList(payload).length;
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

export default function NotificationDropdown() {
  const navigate = useNavigate();
  const POLL_INTERVAL_MS = 30000;
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [items, setItems] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 8,
    total: 0,
    hasNext: false,
  });

  const loadUnreadCount = useCallback(async () => {
    try {
      const response = await api.get('/notifications/', {
        params: { unread: true, page: 1, page_size: 1 },
      });
      setUnreadCount(normalizeCount(response.data));
    } catch {
      setUnreadCount(0);
    }
  }, []);

  const loadNotifications = useCallback(async ({ page = 1, append = false } = {}) => {
    if (append) {
      setLoadingMore(true);
    } else {
      setLoading(true);
    }
    try {
      const response = await api.get('/notifications/', {
        params: { page, page_size: pagination.pageSize },
      });
      const list = normalizeList(response.data);
      setItems((prev) => (append ? [...prev, ...list] : list));
      setPagination((prev) => ({
        ...prev,
        current: page,
        total: typeof response.data?.count === 'number' ? response.data.count : list.length,
        hasNext: Boolean(response.data?.next),
      }));
    } catch {
      message.error('Không thể tải thông báo');
    } finally {
      if (append) {
        setLoadingMore(false);
      } else {
        setLoading(false);
      }
    }
  }, [pagination.pageSize]);

  useEffect(() => {
    loadNotifications({ page: 1 });
    loadUnreadCount();
  }, [loadNotifications, loadUnreadCount]);

  useEffect(() => {
    const timer = setInterval(() => {
      loadUnreadCount();
      if (open) {
        loadNotifications({ page: 1 });
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [open, loadNotifications, loadUnreadCount]);

  const handleOpenChange = (nextOpen) => {
    setOpen(nextOpen);
    if (nextOpen) {
      loadNotifications({ page: 1 });
      loadUnreadCount();
    }
  };

  const handleMarkRead = async (notification) => {
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
      setUnreadCount((prev) => Math.max(prev - 1, 0));
    } catch {
      message.error('Không thể cập nhật thông báo');
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await api.post('/notifications/mark_all_read/');
      setItems((prev) => prev.map((item) => ({ ...item, is_read: true })));
      setUnreadCount(0);
      message.success('Đã đánh dấu tất cả là đã đọc');
    } catch {
      message.error('Không thể đánh dấu tất cả thông báo');
    }
  };

  const getNotificationPath = (type) => {
    if (type === 'REQUEST') return '/request';
    if (type === 'MESSAGE') return '/inbox';
    if (type === 'APPROVAL') return '/approval';
    return '/request';
  };

  const handleNotificationClick = async (item) => {
    if (!item.is_read) {
      await handleMarkRead(item);
    }

    setOpen(false);
    navigate(getNotificationPath(item.type));
  };

  const handleLoadMore = async () => {
    if (!pagination.hasNext || loadingMore) return;
    await loadNotifications({ page: pagination.current + 1, append: true });
  };

  const handleOpenAllNotifications = () => {
    setOpen(false);
    navigate('/notifications');
  };

  const overlayNode = useMemo(
    () => (
      <div className="erp-notification-overlay">
        <div style={{ padding: '12px 14px' }}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }}>
            <Text strong>Thông báo</Text>
            <Space>
              <Badge count={unreadCount} />
              <Button
                type="link"
                size="small"
                disabled={unreadCount === 0}
                style={{ paddingInline: 0 }}
                onClick={handleMarkAllRead}
              >
                Đánh dấu tất cả
              </Button>
            </Space>
          </Space>
        </div>
        <Divider style={{ margin: 0 }} />

        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: 'center' }}>
              <Spin />
            </div>
          ) : items.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có thông báo" style={{ padding: 16 }} />
          ) : (
            <List
              dataSource={items}
              renderItem={(item) => {
                const meta = getTypeMeta(item.type);
                return (
                  <List.Item
                    style={{
                      padding: '10px 14px',
                      cursor: 'pointer',
                      background: item.is_read ? '#fff' : '#f8fbff',
                      borderLeft: item.is_read ? '3px solid transparent' : '3px solid #2563eb',
                    }}
                    onClick={() => handleNotificationClick(item)}
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
        </div>

        {items.length > 0 && (
          <>
            <Divider style={{ margin: 0 }} />
            <div style={{ padding: '10px 14px', textAlign: 'center' }}>
              {pagination.hasNext ? (
                <Button type="link" icon={<DownOutlined />} loading={loadingMore} onClick={handleLoadMore}>
                  Tải thêm thông báo
                </Button>
              ) : (
                <Text type="secondary">Đã hiển thị toàn bộ thông báo</Text>
              )}
            </div>
          </>
        )}

        <Divider style={{ margin: 0 }} />
        <div style={{ padding: '10px 14px', textAlign: 'center' }}>
          <Button type="link" onClick={handleOpenAllNotifications}>
            Xem tất cả thông báo
          </Button>
        </div>
      </div>
    ),
    [
      items,
      loading,
      loadingMore,
      navigate,
      pagination.current,
      pagination.hasNext,
      unreadCount,
    ],
  );

  return (
    <Dropdown
      open={open}
      onOpenChange={handleOpenChange}
      trigger={['click']}
      dropdownRender={() => overlayNode}
    >
      <Button
        shape="circle"
        className="erp-notification-trigger"
        icon={<Badge count={unreadCount || 0} size="small"><BellOutlined /></Badge>}
      />
    </Dropdown>
  );
}
