import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Avatar,
  Badge,
  Button,
  Grid,
  Input,
  Radio,
  Space,
  Tag,
  Table,
  Tooltip,
  Typography,
} from 'antd';
import { EditOutlined, PaperClipOutlined, StarFilled, StarOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { getCurrentUserId } from '../../services/auth';

const { Title, Text } = Typography;
const { Search } = Input;

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

function getUserDisplayText(user, fallbackId) {
  if (user && user.username) {
    const fullName = String(user.full_name || '').trim();
    return fullName ? `${user.username} - ${fullName}` : user.username;
  }
  return fallbackId ? `Người dùng #${fallbackId}` : '-';
}

function getUserRecipient(message, currentUserId) {
  if (!currentUserId || !Array.isArray(message.recipients)) return null;
  return message.recipients.find((recipient) => recipient.user === currentUserId) || null;
}

function isImportantForUser(message, currentUserId) {
  const recipient = getUserRecipient(message, currentUserId);
  return Boolean(recipient?.is_important);
}

function getRelativeTimeLabel(createdAt) {
  if (!createdAt) return '-';

  const created = dayjs(createdAt);
  const now = dayjs();
  const diffMinutes = now.diff(created, 'minute');

  if (diffMinutes < 1) return 'Vừa xong';
  if (diffMinutes < 60) return `${diffMinutes} phút trước`;

  const diffHours = now.diff(created, 'hour');
  if (diffHours < 24) return `${diffHours} giờ trước`;

  const diffDays = now.diff(created, 'day');
  if (diffDays < 7) return `${diffDays} ngày trước`;

  return created.format('DD/MM/YYYY');
}

export default function InboxPage() {
  const screens = Grid.useBreakpoint();
  const navigate = useNavigate();
  const currentUserId = getCurrentUserId();
  const [items, setItems] = useState([]);
  const [userMap, setUserMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [keyword, setKeyword] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 10,
    total: 0,
  });

  const tableScrollY = useMemo(() => {
    if (screens.xxl) return '61vh';
    if (screens.xl) return '59vh';
    if (screens.lg) return '55vh';
    if (screens.md) return '49vh';
    return '46vh';
  }, [screens.lg, screens.md, screens.xl, screens.xxl]);

  const loadUnreadCount = useCallback(async () => {
    try {
      const response = await api.get('/messages/inbox/', {
        params: { unread: true, page: 1 },
      });
      setUnreadCount(normalizeCount(response.data));
    } catch {
      setUnreadCount(0);
    }
  }, []);

  const loadMessages = useCallback(
    async ({ page = 1, activeFilter = filter } = {}) => {
      setLoading(true);
      setError('');

      try {
        const params = { page };
        if (activeFilter === 'unread') {
          params.unread = true;
        }
        if (activeFilter === 'important') {
          params.important = true;
        }

        const response = await api.get('/messages/inbox/', { params });
        const list = normalizeList(response.data);
        const total = normalizeCount(response.data);

        setItems(list);
        setPagination((prev) => ({ ...prev, current: page, total }));
      } catch {
        setError('Không thể tải danh sách tin nhắn. Vui lòng thử lại.');
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    [filter],
  );

  useEffect(() => {
    loadMessages({ page: 1, activeFilter: filter });
    loadUnreadCount();
  }, [filter, loadMessages, loadUnreadCount]);

  useEffect(() => {
    const loadUsers = async () => {
      try {
        const response = await api.get('/users/lookup/');
        const lookup = {};
        normalizeList(response.data).forEach((user) => {
          lookup[user.id] = user;
        });
        setUserMap(lookup);
      } catch {
        setUserMap({});
      }
    };

    loadUsers();
  }, []);

  const handleTableChange = (nextPagination) => {
    const page = nextPagination?.current || 1;
    loadMessages({ page, activeFilter: filter });
  };

  const handleToggleImportant = useCallback(async (record, event) => {
    event.stopPropagation();
    const nextImportant = !isImportantForUser(record, currentUserId);

    try {
      const response = await api.post(`/messages/${record.id}/mark_important/`, {
        is_important: nextImportant,
      });

      setItems((prev) => {
        if (filter === 'important' && !nextImportant) {
          return prev.filter((item) => item.id !== record.id);
        }

        return prev.map((item) => (item.id === record.id ? response.data : item));
      });
    } catch {
      setError('Không thể cập nhật trạng thái tin quan trọng. Vui lòng thử lại.');
    }
  }, [currentUserId, filter]);

  const filteredItems = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return items;

    return items.filter((record) => {
      const senderText = getUserDisplayText(userMap[record.sender], record.sender).toLowerCase();
      const subjectText = String(record.subject || '(Không có tiêu đề)').toLowerCase();
      return senderText.includes(q) || subjectText.includes(q);
    });
  }, [items, keyword, userMap]);

  const inboxStats = useMemo(() => {
    const todayCount = items.filter(
      (item) => item.created_at && dayjs(item.created_at).isSame(dayjs(), 'day'),
    ).length;

    return {
      todayCount,
      visibleCount: filteredItems.length,
    };
  }, [items, filteredItems.length]);

  const columns = useMemo(
    () => [
      {
        title: 'Loại',
        key: 'direction',
        width: 110,
        render: (_, record) => {
          const isSent = record.sender === currentUserId;
          return (
            <Tag className={`status-tag ${isSent ? 'status-tag--processing' : 'status-tag--success'}`}>
              {isSent ? 'Đã gửi' : 'Đến'}
            </Tag>
          );
        },
      },
      {
        title: 'Quan trọng',
        key: 'important',
        width: 100,
        align: 'center',
        render: (_, record) => {
          const isImportant = isImportantForUser(record, currentUserId);

          return (
            <Button
              type="text"
              size="small"
              onClick={(event) => handleToggleImportant(record, event)}
              icon={isImportant ? <StarFilled style={{ color: '#faad14' }} /> : <StarOutlined />}
            />
          );
        },
      },
      {
        title: 'Người gửi',
        dataIndex: 'sender',
        key: 'sender',
        width: 300,
        render: (sender) => {
          const user = userMap[sender];
          const name = getUserDisplayText(user, sender);
          const avatarText = String(name).charAt(0).toUpperCase();

          return (
            <Space>
              <Avatar size={28} style={{ backgroundColor: '#e6f4ff', color: '#1677ff' }}>
                {avatarText}
              </Avatar>
              <Text>{name}</Text>
            </Space>
          );
        },
      },
      {
        title: 'Tiêu đề',
        dataIndex: 'subject',
        key: 'subject',
        render: (subject, record) => {
          const recipient = getUserRecipient(record, currentUserId);
          const isUnread = Boolean(recipient && !recipient.is_read);
          return <Text strong={isUnread}>{subject || '(Không có tiêu đề)'}</Text>;
        },
      },
      {
        title: 'Tệp',
        key: 'attachments',
        width: 110,
        align: 'center',
        render: (_, record) => {
          const count = Array.isArray(record.attachments) ? record.attachments.length : 0;
          if (!count) return <Text type="secondary">-</Text>;

          return (
            <Space size={6} align="center">
              <PaperClipOutlined style={{ color: '#1677ff' }} />
              <Badge
                count={count}
                overflowCount={99}
                style={{ backgroundColor: '#dbeafe', color: '#1d4ed8' }}
              />
            </Space>
          );
        },
      },
      {
        title: 'Thời gian',
        dataIndex: 'created_at',
        key: 'created_at',
        width: 180,
        render: (createdAt) => {
          if (!createdAt) return '-';

          const fullTime = dayjs(createdAt).format('DD/MM/YYYY HH:mm');
          return (
            <Tooltip title={fullTime}>
              <Text>{getRelativeTimeLabel(createdAt)}</Text>
            </Tooltip>
          );
        },
      },
    ],
    [currentUserId, handleToggleImportant, userMap],
  );

  return (
    <div className="fixed-list-page inbox-list-page">
      <Space direction="vertical" size="small" style={{ width: '100%' }} className="fixed-list-page-header inbox-list-header">
        <Space style={{ width: '100%', justifyContent: 'space-between' }} align="center" className="list-page-titlebar">
          <Title
            level={4}
            style={{
              margin: 0,
              color: '#1d4ed8',
              letterSpacing: 0.2,
            }}
          >
            Hộp thư nội bộ
          </Title>

          <Button
            type="primary"
            size="small"
            icon={<EditOutlined />}
            className="inbox-compose-button"
            onClick={() => navigate('/messages/compose')}
          >
            Soạn tin nhắn
          </Button>
        </Space>

        <div className="inbox-stat-row">
          <div className="inbox-stat-chip-wrap">
            <div className="inbox-stat-chip inbox-stat-chip-unread">
              <span className="inbox-stat-chip__label">Tin chưa đọc</span>
              <span className="inbox-stat-chip__value inbox-stat-number-unread">{unreadCount}</span>
            </div>
            <div className="inbox-stat-chip inbox-stat-chip-today">
              <span className="inbox-stat-chip__label">Tin trong hôm nay</span>
              <span className="inbox-stat-chip__value inbox-stat-number-today">{inboxStats.todayCount}</span>
            </div>
          </div>
        </div>

        <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap className="list-page-filterbar">
          <Radio.Group
            optionType="button"
            buttonStyle="solid"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <Radio.Button value="all">Tất cả</Radio.Button>
            <Radio.Button value="unread">Chưa đọc</Radio.Button>
            <Radio.Button value="important">Tin quan trọng</Radio.Button>
          </Radio.Group>

          <Space wrap>
            <Search
              allowClear
              placeholder="Tìm theo tiêu đề hoặc người gửi"
              style={{ width: 300, maxWidth: '100%' }}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
            />
          </Space>
        </Space>

        {keyword && (
          <Text type="secondary">
            Hiển thị {inboxStats.visibleCount} / {items.length} tin nhắn theo bộ lọc tìm kiếm.
          </Text>
        )}

        {error && <Alert type="error" message={error} showIcon />}
      </Space>

      <div className="fixed-list-table">
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={filteredItems}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: pagination.total,
            showSizeChanger: false,
          }}
          onChange={handleTableChange}
          onRow={(record) => ({
            onClick: () => navigate(`/messages/${record.id}`),
          })}
          rowClassName={(record) => {
            const recipient = getUserRecipient(record, currentUserId);
            return recipient && !recipient.is_read ? 'inbox-unread-row' : 'inbox-read-row';
          }}
          scroll={{ x: 1200, y: tableScrollY }}
          sticky
          size="middle"
        />
      </div>
    </div>
  );
}
