import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Col,
  Drawer,
  Dropdown,
  Flex,
  Grid,
  Input,
  message,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { CheckCircleOutlined, CloseCircleOutlined, DownOutlined, EyeOutlined, ThunderboltOutlined, FormOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../services/api';
import { getCurrentUserId } from '../../services/auth';
import CreateRequestModal from './CreateRequestModal';
import QuickCreateModal from './QuickCreateModal';
import RequestStatusTag from './RequestStatusTag';
import '../../index.css';

const { Title, Text } = Typography;

const STATUS_OPTIONS = [
  { label: 'Tất cả trạng thái', value: 'ALL' },
  { label: 'Mới tạo', value: 'CREATED' },
  { label: 'Chờ xử lý', value: 'PENDING' },
  { label: 'Đã nhận', value: 'ACCEPTED' },
  { label: 'Đã từ chối', value: 'REJECTED' },
  { label: 'Đang thực hiện', value: 'IN_PROGRESS' },
  { label: 'Đã hoàn thành', value: 'DONE' },
  { label: 'Không hoàn thành', value: 'FAILED' },
  { label: 'Chờ phê duyệt', value: 'PENDING_APPROVAL' },
  { label: 'Đã phê duyệt', value: 'APPROVED' },
];

const TYPE_LABELS = {
  TASK: 'Công việc',
  APPROVAL: 'Phê duyệt',
};

const PRIORITY_META = {
  LOW: { color: 'success', label: 'Thấp' },
  MEDIUM: { color: 'warning', label: 'Trung bình' },
  HIGH: { color: 'error', label: 'Cao' },
};

const ACTIVE_REQUEST_STATUSES = ['CREATED', 'PENDING', 'ACCEPTED', 'IN_PROGRESS', 'PENDING_APPROVAL'];

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase();
}

function getTypeLabel(type) {
  return TYPE_LABELS[type] || type || '-';
}

function renderPriority(priority) {
  const meta = PRIORITY_META[priority];
  if (!meta) return <Text type="secondary">-</Text>;
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

function isActiveRequest(record) {
  return ACTIVE_REQUEST_STATUSES.includes(record?.status);
}

function isOverdueRequest(record) {
  if (!record?.deadline || !isActiveRequest(record)) return false;
  return dayjs(record.deadline).isBefore(dayjs());
}

function getDeadlineSorterValue(deadline) {
  if (!deadline) return Number.MAX_SAFE_INTEGER;
  const value = dayjs(deadline);
  return value.isValid() ? value.valueOf() : Number.MAX_SAFE_INTEGER;
}

function getCreatedAtSorterValue(createdAt) {
  if (!createdAt) return 0;
  const value = dayjs(createdAt);
  return value.isValid() ? value.valueOf() : 0;
}

const ACTIONS = [
  { key: 'accept', label: 'Chấp nhận', endpoint: 'accept' },
  { key: 'reject', label: 'Từ chối', endpoint: 'reject', danger: true },
  { key: 'done', label: 'Hoàn thành', endpoint: 'mark_done' },
  { key: 'failed', label: 'Không thể hoàn thành', endpoint: 'mark_failed', danger: true },
];

const ACTION_STATUS_RULES = {
  accept: ['CREATED', 'PENDING'],
  reject: ['CREATED', 'PENDING', 'ACCEPTED', 'IN_PROGRESS'],
  done: ['IN_PROGRESS'],
  failed: ['IN_PROGRESS'],
};

function normalizeList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.results)) return payload.results;
  return [];
}

function excludeApprovalRequests(items) {
  return items.filter((item) => item?.type !== 'APPROVAL');
}

function getUserDisplayText(user, fallbackId) {
  if (user && user.username) {
    const fullName = String(user.full_name || '').trim();
    return fullName ? `${user.username} - ${fullName}` : user.username;
  }
  return fallbackId ? `User #${fallbackId}` : '-';
}

function normalizePagination(payload, fallbackPage, fallbackPageSize) {
  if (payload && typeof payload === 'object' && Array.isArray(payload.results)) {
    return {
      total: payload.count || 0,
      current: fallbackPage,
      pageSize: fallbackPageSize,
      usesServerPagination: true,
      hasNext: Boolean(payload.next),
      hasPrevious: Boolean(payload.previous),
    };
  }

  const list = normalizeList(payload);
  return {
    total: list.length,
    current: 1,
    pageSize: fallbackPageSize,
    usesServerPagination: false,
    hasNext: false,
    hasPrevious: false,
  };
}

function getAssigneeText(record, userMap) {
  if (record.target_type === 'DEPARTMENT') {
    return record.target_department_name || `Phòng ban #${record.target_id}`;
  }

  if (Array.isArray(record.assignments) && record.assignments.length > 0) {
    const assigneeIds = record.assignments.map((assignment) => assignment.user);
    const firstUser = getUserDisplayText(userMap[assigneeIds[0]], assigneeIds[0]);
    if (assigneeIds.length >= 2) {
      return `${firstUser} và ${assigneeIds.length - 1} người khác`;
    }
    return firstUser;
  }

  if (record.target_type === 'USER') return getUserDisplayText(userMap[record.target_id], record.target_id);
  return '-';
}

function getDeadlineStatus(deadline) {
  if (!deadline) return null;

  const deadlineValue = dayjs(deadline);
  if (!deadlineValue.isValid()) return null;

  const now = dayjs();
  if (deadlineValue.isBefore(now)) {
    return { color: 'error', label: 'Quá hạn' };
  }

  const hoursLeft = deadlineValue.diff(now, 'hour', true);
  if (hoursLeft <= 24) {
    return { color: 'warning', label: 'Sắp tới hạn' };
  }

  return { color: 'default', label: 'Còn hạn' };
}

function renderDeadline(deadline) {
  if (!deadline) return <Text type="secondary">-</Text>;

  const formattedDeadline = dayjs(deadline).format('DD/MM/YYYY HH:mm');
  const status = getDeadlineStatus(deadline);

  if (!status) {
    return <Text>{formattedDeadline}</Text>;
  }

  return (
    <Space direction="vertical" size={2}>
      <Text>{formattedDeadline}</Text>
      <Tag color={status.color} style={{ width: 'fit-content', marginInlineEnd: 0 }}>
        {status.label}
      </Tag>
    </Space>
  );
}

export default function RequestPage() {
  const screens = Grid.useBreakpoint();
  const currentUserId = getCurrentUserId();
  const [items, setItems] = useState([]);
  const [userMap, setUserMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [debouncedSearchKeyword, setDebouncedSearchKeyword] = useState('');
  const [modalState, setModalState] = useState({ open: false, mode: 'create', record: null });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [detailDrawer, setDetailDrawer] = useState({ open: false, record: null });
  const [reasonModal, setReasonModal] = useState({ open: false, action: null, requestId: null, reason: '' });
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 10,
    total: 0,
    usesServerPagination: false,
    hasNext: false,
    hasPrevious: false,
  });

  const tableScrollY = useMemo(() => {
    if (screens.xxl) return '61vh';
    if (screens.xl) return '59vh';
    if (screens.lg) return '55vh';
    if (screens.md) return '49vh';
    return '46vh';
  }, [screens.lg, screens.md, screens.xl, screens.xxl]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchKeyword(searchKeyword);
    }, 300);

    return () => clearTimeout(timer);
  }, [searchKeyword]);

  const loadRequests = useCallback(async ({ page = 1, pageSize = 10 } = {}) => {
    setLoading(true);
    setError('');

    try {
      const params = { type: 'TASK' };
      if (statusFilter !== 'ALL') params.status = statusFilter;
      const normalizedQuery = normalizeSearchText(debouncedSearchKeyword);
      if (normalizedQuery) params.q = normalizedQuery;
      params.page = page;

      const response = await api.get('/requests/', { params });
      setItems(excludeApprovalRequests(normalizeList(response.data)));
      const paging = normalizePagination(response.data, page, pageSize);
      setPagination((prev) => ({
        ...prev,
        ...paging,
        current: paging.usesServerPagination ? page : 1,
      }));
    } catch {
      setError('Không thể tải danh sách yêu cầu. Vui lòng thử lại.');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearchKeyword, statusFilter]);

  useEffect(() => {
    loadRequests({ page: 1, pageSize: pagination.pageSize });
  }, [debouncedSearchKeyword, statusFilter, loadRequests, pagination.pageSize]);

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

  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [isQuickSubmitting, setIsQuickSubmitting] = useState(false);

  const openCreateModal = () => {
    setModalState({ open: true, mode: 'create', record: null });
  };

  const openDetailedCreateModal = () => {
    setModalState({ open: true, mode: 'create', record: null });
  };

  const openQuickCreateModal = () => {
    setQuickCreateOpen(true);
  };

  const closeQuickCreateModal = () => {
    setQuickCreateOpen(false);
  };

  const openEditModal = (record) => {
    setModalState({ open: true, mode: 'edit', record });
  };

  const closeModal = () => {
    setModalState({ open: false, mode: 'create', record: null });
  };

  const openDetailDrawer = (record) => {
    setDetailDrawer({ open: true, record });
  };

  const closeDetailDrawer = () => {
    setDetailDrawer({ open: false, record: null });
  };

  const openReasonModal = (action, requestId) => {
    setReasonModal({ open: true, action, requestId, reason: '' });
  };

  const closeReasonModal = () => {
    setReasonModal({ open: false, action: null, requestId: null, reason: '' });
  };

  const uploadRequestFiles = async (requestId, files) => {
    if (!files || files.length === 0) return;
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    try {
      await api.post(`/requests/${requestId}/attachments/`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
    } catch {
      message.warning('Yêu cầu đã tạo nhưng không thể tải lên tệp đính kèm.');
    }
  };

  const handleSubmitRequest = async (payload) => {
    setIsSubmitting(true);
    try {
      const files = payload._files || [];
      const normalizedTargetIds = Array.isArray(payload.target_id)
        ? payload.target_id.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
        : [];
      const primaryTargetId = normalizedTargetIds.length > 0
        ? normalizedTargetIds[0]
        : Number(payload.target_id);

      // eslint-disable-next-line no-unused-vars
      const { _files, ...cleanPayload } = payload;
      const requestPayload = {
        ...cleanPayload,
        target_id: primaryTargetId,
        deadline: cleanPayload.deadline ? cleanPayload.deadline.toISOString() : null,
        workflow: cleanPayload.workflow ? Number(cleanPayload.workflow) : undefined,
      };

      if (cleanPayload.target_type === 'USER' && normalizedTargetIds.length > 0) {
        requestPayload.target_ids = normalizedTargetIds;
      }

      if (modalState.mode === 'edit' && modalState.record?.id) {
        await api.put(`/requests/${modalState.record.id}/`, requestPayload);
        if (files.length > 0) await uploadRequestFiles(modalState.record.id, files);
        message.success('Đã cập nhật yêu cầu');
      } else {
        const response = await api.post('/requests/', requestPayload);
        const newRequestId = response.data?.id;
        if (newRequestId && files.length > 0) await uploadRequestFiles(newRequestId, files);
        message.success('Đã tạo yêu cầu mới');
      }
      closeModal();
      loadRequests({ page: 1, pageSize: pagination.pageSize });
    } catch (error) {
      const data = error?.response?.data;
      const detail =
        data?.detail
        || (data && typeof data === 'object' ? Object.values(data).flat()[0] : null)
        || 'Không thể lưu yêu cầu';
      message.error(String(detail));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQuickSubmitRequest = async (payload) => {
    setIsQuickSubmitting(true);
    try {
      const normalizedTargetIds = Array.isArray(payload.target_id)
        ? payload.target_id.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)
        : [];
      const primaryTargetId = normalizedTargetIds.length > 0
        ? normalizedTargetIds[0]
        : Number(payload.target_id);

      const requestPayload = {
        title: payload.title,
        description: payload.description || '',
        type: 'TASK',
        target_type: payload.target_type,
        target_id: primaryTargetId,
        ...(payload.target_type === 'USER' && normalizedTargetIds.length > 0 ? { target_ids: normalizedTargetIds } : {}),
      };

      await api.post('/requests/', requestPayload);
      message.success('Đã tạo yêu cầu nhanh');
      closeQuickCreateModal();
      loadRequests({ page: 1, pageSize: pagination.pageSize });
    } catch (error) {
      const data = error?.response?.data;
      const detail =
        data?.detail
        || (data && typeof data === 'object' ? Object.values(data).flat()[0] : null)
        || 'Không thể tạo yêu cầu nhanh';
      message.error(String(detail));
    } finally {
      setIsQuickSubmitting(false);
    }
  };

  const handleDeleteRequest = async (record) => {
    setActionLoadingId(`${record.id}-delete`);
    try {
      await api.delete(`/requests/${record.id}/`);
      message.success('Đã xóa yêu cầu');
      loadRequests({ page: pagination.current, pageSize: pagination.pageSize });
    } catch (error) {
      const detail = error?.response?.data?.detail || 'Không thể xóa yêu cầu';
      message.error(detail);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleAction = async (requestId, action) => {
    // For reject and failed actions, open reason modal
    if (action.key === 'reject' || action.key === 'failed') {
      openReasonModal(action, requestId);
      return;
    }

    // For other actions, execute directly
    setActionLoadingId(`${requestId}-${action.key}`);
    try {
      await api.post(`/requests/${requestId}/${action.endpoint}/`);
      message.success(`${action.label} thành công`);
      loadRequests({ page: pagination.current, pageSize: pagination.pageSize });
    } catch {
      message.error(`${action.label} thất bại`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const handleReasonModalSubmit = async () => {
    if (!reasonModal.reason.trim()) {
      message.warning('Vui lòng nhập lý do');
      return;
    }

    setActionLoadingId(`${reasonModal.requestId}-${reasonModal.action.key}`);
    try {
      await api.post(`/requests/${reasonModal.requestId}/${reasonModal.action.endpoint}/`, {
        reason: reasonModal.reason,
      });
      message.success(`${reasonModal.action.label} thành công`);
      loadRequests({ page: pagination.current, pageSize: pagination.pageSize });
      closeReasonModal();
    } catch {
      message.error(`${reasonModal.action.label} thất bại`);
    } finally {
      setActionLoadingId(null);
    }
  };

  const getCurrentAssignment = (record) => {
    if (!currentUserId || !Array.isArray(record.assignments)) return null;
    return record.assignments.find((assignment) => assignment.user === currentUserId) || null;
  };

  const isCurrentUserRecipient = (record) => {
    return getCurrentAssignment(record) !== null;
  };

  const canRenderAction = (record, actionKey) => {
    const currentAssignment = getCurrentAssignment(record);
    if (!currentAssignment) return false;

    const allowedStatuses = ACTION_STATUS_RULES[actionKey] || [];
    if (!allowedStatuses.includes(record.status)) return false;

    if (actionKey === 'accept' || actionKey === 'reject') {
      return currentAssignment.status === 'PENDING';
    }

    if (actionKey === 'done' || actionKey === 'failed') {
      return currentAssignment.status === 'ACCEPTED';
    }

    return false;
  };

  const handleTableChange = (nextPagination) => {
    const page = nextPagination?.current || 1;
    const pageSize = nextPagination?.pageSize || pagination.pageSize;
    setPagination((prev) => ({ ...prev, current: page, pageSize }));
    loadRequests({ page, pageSize });
  };

  const canSenderModifyRequest = (record) => {
    if (!currentUserId || record.created_by !== currentUserId) return false;
    if (!Array.isArray(record.assignments) || record.assignments.length === 0) return false;
    return record.assignments.every((assignment) => assignment.status === 'PENDING');
  };

  const getRowClassName = (record) => {
    const classNames = [];

    if (isActiveRequest(record)) {
      classNames.push('request-row-active');
    } else {
      classNames.push('request-row-completed');
    }

    if (isOverdueRequest(record)) {
      classNames.push('request-row-overdue');
    }

    return classNames.join(' ');
  };

  const columns = useMemo(
    () => [
      {
        title: 'STT',
        key: 'index',
        width: 80,
        render: (_, __, index) => ((pagination.current - 1) * pagination.pageSize) + index + 1,
      },
      {
        title: 'Tiêu đề',
        dataIndex: 'title',
        key: 'title',
        width: 200,
        render: (title) => {
          if (!title) return <Text type="secondary">-</Text>;
          return <span>{title.charAt(0).toUpperCase() + title.slice(1)}</span>;
        },
      },
      {
        title: 'Trạng thái',
        dataIndex: 'status',
        key: 'status',
        width: 140,
        render: (status) => <RequestStatusTag status={status} />,
      },
      {
        title: 'Ưu tiên',
        dataIndex: 'priority',
        key: 'priority',
        width: 120,
        render: (priority) => renderPriority(priority),
      },
      {
        title: 'Người tạo',
        dataIndex: 'created_by',
        key: 'created_by',
        width: 180,
        render: (createdBy) => getUserDisplayText(userMap[createdBy], createdBy),
      },
      {
        title: 'Người được giao',
        key: 'assignee',
        width: 200,
        render: (_, record) => getAssigneeText(record, userMap),
      },
      {
        title: 'Ghi chú',
        dataIndex: 'notes',
        key: 'notes',
        width: 150,
        render: (notes) => (notes ? <Text ellipsis title={notes}>{notes}</Text> : <Text type="secondary">-</Text>),
      },
      {
        title: 'Deadline',
        dataIndex: 'deadline',
        key: 'deadline',
        width: 170,
        sorter: (a, b) => getDeadlineSorterValue(a.deadline) - getDeadlineSorterValue(b.deadline),
        render: (deadline) => renderDeadline(deadline),
      },
      {
        title: 'Ngày tạo',
        dataIndex: 'created_at',
        key: 'created_at',
        width: 150,
        sorter: (a, b) => getCreatedAtSorterValue(a.created_at) - getCreatedAtSorterValue(b.created_at),
        defaultSortOrder: 'descend',
        render: (createdAt) => (createdAt ? dayjs(createdAt).format('DD/MM/YYYY HH:mm') : '-'),
      },
      {
        title: 'Hành động',
        key: 'actions',
        width: 320,
        render: (_, record) => {
          if (!currentUserId) return <Text type="secondary">-</Text>;

          const isRecipient = isCurrentUserRecipient(record);
          const isSender = record.created_by === currentUserId;

          // For recipients, show actions and completion status
          if (isRecipient) {
            const hasActions = ACTIONS.some((action) => canRenderAction(record, action.key));
            
            if (record.status === 'DONE') {
              return (
                <Space wrap>
                  <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 18 }} title="Đã hoàn thành" />
                  <Button
                    type="text"
                    size="small"
                    icon={<EyeOutlined />}
                    onClick={() => openDetailDrawer(record)}
                  >
                    Xem
                  </Button>
                </Space>
              );
            }

            if (record.status === 'FAILED') {
              return (
                <Space wrap>
                  <CloseCircleOutlined style={{ color: '#f5222d', fontSize: 18 }} title="Không hoàn thành" />
                  <Button
                    type="text"
                    size="small"
                    icon={<EyeOutlined />}
                    onClick={() => openDetailDrawer(record)}
                  >
                    Xem
                  </Button>
                </Space>
              );
            }

            if (hasActions) {
              return (
                <Space wrap>
                  {ACTIONS.filter((action) => canRenderAction(record, action.key)).map((action) => {
                    const loadingKey = `${record.id}-${action.key}`;
                    return (
                      <Popconfirm
                        key={action.key}
                        title={`Xác nhận ${action.label}?`}
                        onConfirm={() => handleAction(record.id, action)}
                        okText="Đồng ý"
                        cancelText="Huỷ"
                      >
                        <Button
                          size="small"
                          danger={action.danger}
                          loading={actionLoadingId === loadingKey}
                        >
                          {action.label}
                        </Button>
                      </Popconfirm>
                    );
                  })}
                  <Button
                    type="text"
                    size="small"
                    icon={<EyeOutlined />}
                    onClick={() => openDetailDrawer(record)}
                  >
                    Xem
                  </Button>
                </Space>
              );
            }
          }

          // For senders, show status indicator and view button
          if (isSender) {
            let statusDisplay = null;
            
            if (record.status === 'IN_PROGRESS') {
              statusDisplay = <Tag color="processing">Đang thực hiện</Tag>;
            } else if (record.status === 'REJECTED') {
              statusDisplay = <Tag color="error">Đã bị từ chối</Tag>;
            } else if (record.status === 'DONE') {
              const completedBy = record.assignments?.find((a) => a.status === 'DONE')?.user;
              const completedByUser = completedBy ? userMap[completedBy] : null;
              statusDisplay = (
                <Space size="small" style={{ fontSize: 12 }}>
                  <CheckCircleOutlined style={{ color: '#52c41a' }} />
                  <span>Đã hoàn thành bởi {getUserDisplayText(completedByUser, completedBy)}</span>
                </Space>
              );
            } else if (record.status === 'FAILED') {
              const failedBy = record.assignments?.find((a) => a.status === 'REJECTED')?.user;
              const failedByUser = failedBy ? userMap[failedBy] : null;
              statusDisplay = (
                <Space size="small" style={{ fontSize: 12 }}>
                  <CloseCircleOutlined style={{ color: '#f5222d' }} />
                  <span>Không hoàn thành bởi {getUserDisplayText(failedByUser, failedBy)}</span>
                </Space>
              );
            }

            if (statusDisplay) {
              return (
                <Space wrap>
                  {statusDisplay}
                  <Button
                    type="text"
                    size="small"
                    icon={<EyeOutlined />}
                    onClick={() => openDetailDrawer(record)}
                  >
                    Xem
                  </Button>
                </Space>
              );
            }
          }

          // Default fallback
          return (
            <Space wrap>
              <Button
                type="text"
                size="small"
                icon={<EyeOutlined />}
                onClick={() => openDetailDrawer(record)}
              >
                Xem
              </Button>
              {canSenderModifyRequest(record) && (
                <>
                  <Button size="small" onClick={() => openEditModal(record)}>
                    Sửa
                  </Button>
                  <Popconfirm 
                    title="Xác nhận xóa yêu cầu?" 
                    onConfirm={() => handleDeleteRequest(record)}
                    okText="Đồng ý"
                    cancelText="Huỷ"
                  >
                    <Button size="small" danger loading={actionLoadingId === `${record.id}-delete`}>
                      Xóa
                    </Button>
                  </Popconfirm>
                </>
              )}
            </Space>
          );
        },
      },
    ],
    [actionLoadingId, currentUserId, pagination.current, pagination.pageSize, userMap],
  );

  return (
    <div className="fixed-list-page request-list-page">
      <Space direction="vertical" size="small" style={{ width: '100%' }} className="fixed-list-page-header request-list-header">
        <Flex justify="space-between" align="center" wrap="wrap" gap={12} className="list-page-titlebar">
          <div>
            <Title level={4} style={{ margin: 0 }}>
              Quản lý các yêu cầu xử lý công việc nội bộ
            </Title>
            {screens.md && <Text type="secondary">Theo dõi và xử lý các yêu cầu công việc trong hệ thống</Text>}
          </div>

          <Dropdown
            menu={{
              items: [
                {
                  key: 'quick',
                  icon: <ThunderboltOutlined />,
                  label: 'Tạo yêu cầu nhanh',
                },
                {
                  key: 'detailed',
                  icon: <FormOutlined />,
                  label: 'Tạo yêu cầu chi tiết',
                },
              ],
              onClick: ({ key }) => {
                if (key === 'quick') openQuickCreateModal();
                else openDetailedCreateModal();
              },
            }}
            trigger={['click']}
          >
            <Button type="primary">
              Tạo yêu cầu mới <DownOutlined />
            </Button>
          </Dropdown>
        </Flex>

        <Row gutter={[12, 12]} className="list-page-filterbar">
          <Col xs={24} sm={24} md={14} lg={9}>
            <Input.Search
              allowClear
              placeholder="Tìm theo tiêu đề hoặc người gửi/nhận"
              value={searchKeyword}
              onChange={(event) => setSearchKeyword(event.target.value)}
            />
          </Col>

          <Col xs={24} sm={12} md={8} lg={6}>
            <Select
              style={{ width: '100%' }}
              value={statusFilter}
              options={STATUS_OPTIONS}
              onChange={setStatusFilter}
            />
          </Col>
        </Row>

        {error && <Alert type="error" message={error} showIcon />}
      </Space>

      <div className="fixed-list-table">
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={items}
          rowClassName={getRowClassName}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: pagination.total,
            showSizeChanger: false,
          }}
          onChange={handleTableChange}
          scroll={{ x: 1660, y: tableScrollY }}
          sticky
          size="middle"
        />
      </div>

      <CreateRequestModal
        open={modalState.open}
        mode={modalState.mode}
        initialValues={modalState.record}
        lockedType="TASK"
        submitting={isSubmitting}
        onSubmit={handleSubmitRequest}
        onCancel={closeModal}
      />

      <QuickCreateModal
        open={quickCreateOpen}
        submitting={isQuickSubmitting}
        onSubmit={handleQuickSubmitRequest}
        onCancel={closeQuickCreateModal}
      />

      {/* Detail Drawer */}
      <Drawer
        title="Chi tiết yêu cầu"
        onClose={closeDetailDrawer}
        open={detailDrawer.open}
        width={600}
      >
        {detailDrawer.record && (
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <div>
              <Text strong>ID:</Text>
              <Text> {detailDrawer.record.id}</Text>
            </div>
            <div>
              <Text strong>Tiêu đề:</Text>
              <Text> {detailDrawer.record.title}</Text>
            </div>
            <div>
              <Text strong>Mô tả:</Text>
              <Text> {detailDrawer.record.description || '-'}</Text>
            </div>
            <div>
              <Text strong>Loại:</Text>
              <Text> {getTypeLabel(detailDrawer.record.type)}</Text>
            </div>
            <div>
              <Text strong>Trạng thái:</Text>
              <div><RequestStatusTag status={detailDrawer.record.status} /></div>
            </div>
            <div>
              <Text strong>Ưu tiên:</Text>
              <div style={{ marginTop: 4 }}>{renderPriority(detailDrawer.record.priority)}</div>
            </div>
            <div>
              <Text strong>Deadline:</Text>
              <div style={{ marginTop: 4 }}>{renderDeadline(detailDrawer.record.deadline)}</div>
            </div>
            <div>
              <Text strong>Người tạo:</Text>
              <Text> {getUserDisplayText(userMap[detailDrawer.record.created_by], detailDrawer.record.created_by)}</Text>
            </div>
            {detailDrawer.record.assignments && detailDrawer.record.assignments.length > 0 && (
              <div>
                <Text strong>Người được giao:</Text>
                <ul style={{ marginTop: 8 }}>
                  {detailDrawer.record.assignments.map((assignment) => (
                    <li key={assignment.id}>
                      <Text>{getUserDisplayText(userMap[assignment.user], assignment.user)}</Text>
                      <Tag style={{ marginLeft: 8 }}>{assignment.status}</Tag>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {detailDrawer.record.notes && (
              <div>
                <Text strong>Ghi chú:</Text>
                <Text> {detailDrawer.record.notes}</Text>
              </div>
            )}
            <div>
              <Text strong>Ngày tạo:</Text>
              <Text> {dayjs(detailDrawer.record.created_at).format('DD/MM/YYYY HH:mm:ss')}</Text>
            </div>
            <div>
              <Text strong>Ngày cập nhật:</Text>
              <Text> {dayjs(detailDrawer.record.updated_at).format('DD/MM/YYYY HH:mm:ss')}</Text>
            </div>
          </Space>
        )}
      </Drawer>

      {/* Reason Modal */}
      <Modal
        title={reasonModal.action ? `${reasonModal.action.label}` : 'Nhập lý do'}
        open={reasonModal.open}
        onOk={handleReasonModalSubmit}
        onCancel={closeReasonModal}
        okText="Xác nhận"
        cancelText="Huỷ"
      >
        <Input.TextArea
          rows={4}
          placeholder={
            reasonModal.action?.key === 'reject'
              ? 'Nhập lý do từ chối...'
              : 'Nhập lý do không hoàn thành...'
          }
          value={reasonModal.reason}
          onChange={(e) => setReasonModal((prev) => ({ ...prev, reason: e.target.value }))}
        />
      </Modal>
    </div>
  );
}
