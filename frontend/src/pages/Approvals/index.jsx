import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Collapse,
  DatePicker,
  Drawer,
  Form,
  Grid,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
} from 'antd';
import { AppstoreOutlined, CalendarOutlined, CheckOutlined, CloseOutlined, DeleteOutlined, EditOutlined, EyeOutlined, FileTextOutlined, ShoppingCartOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../services/api';
import { getCurrentUserId } from '../../services/auth';
import ApprovalActionModal from './ApprovalActionModal';

const { Title, Text } = Typography;

const PRIORITY_OPTIONS = [
  { label: 'Thấp', value: 'LOW' },
  { label: 'Trung bình', value: 'MEDIUM' },
  { label: 'Cao', value: 'HIGH' },
];

const CATEGORY_LABELS = {
  LEAVE: 'Nghỉ phép',
  PURCHASE: 'Mua sắm',
  DOCUMENT: 'Chứng từ',
  TASK: 'Công việc',
};

const APPROVAL_STATUS_OPTIONS = [
  { value: 'ALL', label: 'Tất cả trạng thái' },
  { value: 'PENDING_APPROVAL', label: 'Chờ phê duyệt' },
  { value: 'APPROVED', label: 'Đã duyệt' },
  { value: 'REJECTED', label: 'Đã từ chối' },
  { value: 'FAILED', label: 'Thất bại' },
];

function normalizeList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.results)) return payload.results;
  return [];
}

function normalizePagination(payload, fallbackPage, fallbackPageSize) {
  if (payload && typeof payload === 'object' && Array.isArray(payload.results)) {
    return {
      total: payload.count || 0,
      current: fallbackPage,
      pageSize: fallbackPageSize,
      usesServerPagination: true,
    };
  }

  const list = normalizeList(payload);
  return {
    total: list.length,
    current: 1,
    pageSize: fallbackPageSize,
    usesServerPagination: false,
  };
}

function normalizeSearchText(value) {
  return String(value || '').trim().toLowerCase();
}

function formatDateTime(value) {
  const parsed = dayjs(value);
  if (!parsed.isValid()) return '';
  return parsed.format('DD/MM/YYYY HH:mm');
}

function isLikelyDateField(fieldName) {
  return /(date|ngay|deadline|time|_at|at)$/i.test(String(fieldName || '').trim());
}

function isLikelyDateString(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  if (!text) return false;
  if (/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/i.test(text)) {
    return true;
  }
  if (/^\d{2}\/\d{2}\/\d{4}(?:\s+\d{2}:\d{2}(?::\d{2})?)?$/i.test(text)) {
    return true;
  }
  return false;
}

function prettifyFieldLabel(key) {
  const raw = String(key || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw) return '';
  // Split by space then capitalize only the FIRST character of each word.
  // Avoids \b\w which creates incorrect word boundaries inside Vietnamese words
  // (e.g. "tên nhà cung cấp" → "TêN Nhà Cung CấP" due to accented char boundaries).
  return raw
    .split(' ')
    .map((word) => (word ? word.charAt(0).toUpperCase() + word.slice(1) : ''))
    .join(' ');
}

function normalizeDetailFieldKey(key) {
  return String(key || '')
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .trim()
    .toLowerCase();
}

const DETAIL_FIELD_LABELS = {
  title: 'Tiêu đề',
  name: 'Tên',
  full_name: 'Họ và tên',
  leave_type: 'Loại nghỉ',
  leave_reason: 'Lý do nghỉ',
  leave_days: 'Số ngày nghỉ',
  days: 'Số ngày',
  category: 'Loại yêu cầu',
  description: 'Mô tả',
  reason: 'Lý do',
  note: 'Ghi chú',
  notes: 'Ghi chú',
  content: 'Nội dung',
  amount: 'Số tiền',
  total_amount: 'Tổng tiền',
  price: 'Đơn giá',
  quantity: 'Số lượng',
  department: 'Phòng ban',
  department_name: 'Tên phòng ban',
  manager: 'Người quản lý',
  approver: 'Người phê duyệt',
  start_date: 'Ngày bắt đầu',
  end_date: 'Ngày kết thúc',
  from_date: 'Từ ngày',
  to_date: 'Đến ngày',
  request_date: 'Ngày yêu cầu',
  due_date: 'Hạn xử lý',
  deadline: 'Hạn xử lý',
  created_at: 'Ngày tạo',
  updated_at: 'Ngày cập nhật',
  file: 'Tệp đính kèm',
  file_name: 'Tên tệp',
  attachment: 'Tệp đính kèm',
  link: 'Liên kết',
  url: 'Đường dẫn',
  code: 'Mã',
  employee_id: 'Mã nhân viên',
};

const CATEGORY_DETAIL_FIELD_LABELS = {
  LEAVE: {
    leave_type: 'Loại nghỉ',
    leave_reason: 'Lý do nghỉ',
    reason_leave: 'Lý do nghỉ',
    from_date: 'Từ ngày',
    to_date: 'Đến ngày',
    start_date: 'Ngày bắt đầu nghỉ',
    end_date: 'Ngày kết thúc nghỉ',
    days: 'Số ngày nghỉ',
    leave_days: 'Số ngày nghỉ',
    half_day_session: 'Buổi nghỉ',
  },
  PURCHASE: {
    item: 'Hạng mục mua sắm',
    item_name: 'Tên hạng mục',
    product_name: 'Tên sản phẩm',
    vendor: 'Nhà cung cấp',
    supplier: 'Nhà cung cấp',
    quantity: 'Số lượng',
    unit_price: 'Đơn giá',
    total_amount: 'Tổng chi phí',
    budget_code: 'Mã ngân sách',
    purpose: 'Mục đích mua sắm',
  },
  DOCUMENT: {
    document_type: 'Loại chứng từ',
    document_name: 'Tên chứng từ',
    document_no: 'Số chứng từ',
    document_number: 'Số chứng từ',
    issue_date: 'Ngày phát hành',
    effective_date: 'Ngày hiệu lực',
    signer: 'Người ký',
    recipient: 'Nơi nhận',
  },
  TASK: {
    task_name: 'Tên công việc',
    task_type: 'Loại công việc',
    objective: 'Mục tiêu',
    deliverable: 'Kết quả cần bàn giao',
    assignee: 'Người thực hiện',
    owner: 'Người phụ trách',
    start_date: 'Ngày bắt đầu',
    end_date: 'Ngày hoàn thành',
    due_date: 'Hạn hoàn thành',
  },
};

const DETAIL_VALUE_LABELS = {
  annual: 'Nghỉ phép năm',
  unpaid: 'Nghỉ không lương',
  sick: 'Nghỉ ốm',
  maternity: 'Nghỉ thai sản',
  personal: 'Việc riêng',
  emergency: 'Khẩn cấp',
  half_day: 'Nửa ngày',
  full_day: 'Cả ngày',
  morning: 'Buổi sáng',
  afternoon: 'Buổi chiều',
  yes: 'Có',
  no: 'Không',
};

const CATEGORY_DETAIL_VALUE_LABELS = {
  LEAVE: {
    annual: 'Nghỉ phép năm',
    unpaid: 'Nghỉ không lương',
    sick: 'Nghỉ ốm',
    maternity: 'Nghỉ thai sản',
    personal: 'Nghỉ việc riêng',
    bereavement: 'Nghỉ tang',
    marriage: 'Nghỉ kết hôn',
    half_day: 'Nửa ngày',
    full_day: 'Cả ngày',
    morning: 'Buổi sáng',
    afternoon: 'Buổi chiều',
  },
  PURCHASE: {
    office_supply: 'Văn phòng phẩm',
    equipment: 'Thiết bị',
    service: 'Dịch vụ',
    software: 'Phần mềm',
    urgent: 'Khẩn cấp',
  },
  DOCUMENT: {
    contract: 'Hợp đồng',
    invoice: 'Hóa đơn',
    payment: 'Phiếu thanh toán',
    proposal: 'Tờ trình',
    decision: 'Quyết định',
  },
  TASK: {
    internal: 'Nội bộ',
    external: 'Bên ngoài',
    urgent: 'Khẩn cấp',
    normal: 'Bình thường',
    high: 'Ưu tiên cao',
    medium: 'Ưu tiên trung bình',
    low: 'Ưu tiên thấp',
  },
};

function getDetailFieldLabel(key, category = '') {
  const normalizedKey = normalizeDetailFieldKey(key);
  const categoryKey = String(category || '').trim().toUpperCase();
  return CATEGORY_DETAIL_FIELD_LABELS[categoryKey]?.[normalizedKey]
    || DETAIL_FIELD_LABELS[normalizedKey]
    || prettifyFieldLabel(key);
}

function getDetailValueLabel(value, fieldName = '', category = '') {
  const normalizedValue = normalizeDetailFieldKey(value);
  const normalizedFieldName = normalizeDetailFieldKey(fieldName);
  const categoryKey = String(category || '').trim().toUpperCase();

  if (CATEGORY_DETAIL_VALUE_LABELS[categoryKey]?.[normalizedValue]) {
    return CATEGORY_DETAIL_VALUE_LABELS[categoryKey][normalizedValue];
  }

  if (normalizedFieldName === 'leave_type' && DETAIL_VALUE_LABELS[normalizedValue]) {
    return DETAIL_VALUE_LABELS[normalizedValue];
  }

  return DETAIL_VALUE_LABELS[normalizedValue] || '';
}

const FORM_GROUPS = [
  {
    key: 'general',
    label: 'Thông tin chung',
    match: /(title|name|type|category|content|description|reason|muc dich|noi dung|ghi chu|note)/i,
  },
  {
    key: 'timeline',
    label: 'Thời gian',
    match: /(date|time|deadline|from|to|start|end|ngay|gio|thoi gian|bat dau|ket thuc|_at$)/i,
  },
  {
    key: 'finance',
    label: 'Tài chính',
    match: /(amount|total|cost|price|budget|currency|gia|tien|chi phi|tong|so luong)/i,
  },
  {
    key: 'people',
    label: 'Nhân sự',
    match: /(user|employee|staff|approver|manager|department|team|nguoi|nhan vien|phong ban|bo phan)/i,
  },
  {
    key: 'reference',
    label: 'Tệp và tham chiếu',
    match: /(file|attachment|link|url|code|id|ref|ma|tep|dinh kem)/i,
  },
];

function getFormGroup(fieldKey, fieldLabel) {
  const text = `${fieldKey || ''} ${fieldLabel || ''}`.toLowerCase();
  return FORM_GROUPS.find((group) => group.match.test(text))?.key || 'other';
}

function getFormGroupLabel(groupKey) {
  if (groupKey === 'other') return 'Chi tiết';
  return FORM_GROUPS.find((group) => group.key === groupKey)?.label || 'Khác';
}

function formatDetailValue(value, fieldName = '', category = '') {
  if (value === null || value === undefined || value === '') return '-';

  if (typeof value === 'boolean') {
    return value ? 'Có' : 'Không';
  }

  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => formatDetailValue(item, fieldName, category))
      .filter((item) => item && item !== '-');
    if (normalized.length === 0) return '-';
    if (normalized.length <= 2) return normalized.join(', ');
    return `${normalized.slice(0, 2).join(', ')} +${normalized.length - 2}`;
  }

  if (typeof value === 'object') {
    if (value.label) return String(value.label);
    if (value.name) return String(value.name);
    if (value.title) return String(value.title);
    return 'Có dữ liệu';
  }

  const text = String(value).trim();
  if (!text) return '-';

  const translatedValue = getDetailValueLabel(text, fieldName, category);
  if (translatedValue) return translatedValue;

  if (isLikelyDateField(fieldName) || isLikelyDateString(text)) {
    const formattedDate = formatDateTime(text);
    if (formattedDate) return formattedDate;
  }

  return text;
}

function getRequestStatusMeta(status) {
  const statusMap = {
    CREATED: { tone: 'neutral', label: 'Mới tạo' },
    PENDING_APPROVAL: { tone: 'warning', label: 'Chờ phê duyệt' },
    APPROVED: { tone: 'success', label: 'Đã duyệt' },
    REJECTED: { tone: 'error', label: 'Đã từ chối' },
    FAILED: { tone: 'error', label: 'Thất bại' },
    IN_PROGRESS: { tone: 'processing', label: 'Đang xử lý' },
  };
  return statusMap[status] || { tone: 'neutral', label: status || 'Không xác định' };
}

function getUserDisplayText(user, fallbackId) {
  if (user && user.username) {
    const fullName = String(user.full_name || '').trim();
    return fullName ? `${user.username} - ${fullName}` : user.username;
  }
  return fallbackId ? `User #${fallbackId}` : '-';
}

function getDeadlineStatus(deadline) {
  if (!deadline) return null;
  const deadlineValue = dayjs(deadline);
  if (!deadlineValue.isValid()) return null;

  if (deadlineValue.isBefore(dayjs())) {
    return { color: 'error', label: 'Quá hạn' };
  }

  const hoursLeft = deadlineValue.diff(dayjs(), 'hour', true);
  if (hoursLeft <= 24) {
    return { color: 'warning', label: 'Sắp tới hạn' };
  }

  return { color: 'default', label: 'Còn hạn' };
}

function getDeadlineProgress(deadline, createdAt) {
  if (!deadline) return null;

  const deadlineValue = dayjs(deadline);
  if (!deadlineValue.isValid()) return null;

  const now = dayjs();
  const createdValue = createdAt && dayjs(createdAt).isValid() ? dayjs(createdAt) : null;

  if (!createdValue || !createdValue.isBefore(deadlineValue)) {
    const hoursLeft = deadlineValue.diff(now, 'hour', true);
    if (hoursLeft <= 0) {
      return { percent: 100, status: 'exception', hint: 'Đã quá hạn' };
    }
    if (hoursLeft <= 24) {
      return { percent: 85, status: 'active', hint: `${Math.ceil(hoursLeft)} giờ còn lại` };
    }
    return { percent: 40, status: 'active', hint: `${deadlineValue.diff(now, 'day')} ngày còn lại` };
  }

  const totalMs = deadlineValue.valueOf() - createdValue.valueOf();
  const elapsedMs = Math.max(0, now.valueOf() - createdValue.valueOf());
  const percent = Math.min(100, Math.round((elapsedMs / totalMs) * 100));
  const isOverdue = now.isAfter(deadlineValue);
  const hoursLeft = deadlineValue.diff(now, 'hour', true);

  if (isOverdue) {
    return { percent: 100, status: 'exception', hint: 'Đã quá hạn' };
  }
  if (hoursLeft <= 24) {
    return { percent: Math.max(percent, 80), status: 'active', hint: `${Math.ceil(hoursLeft)} giờ còn lại` };
  }
  return { percent, status: 'active', hint: `${deadlineValue.diff(now, 'day')} ngày còn lại` };
}

function renderDeadline(deadline, createdAt) {
  if (!deadline) return <Text type="secondary">-</Text>;

  const formattedDeadline = dayjs(deadline).format('DD/MM/YYYY HH:mm');
  const status = getDeadlineStatus(deadline);
  const timeline = getDeadlineProgress(deadline, createdAt);

  if (!status) return <Text>{formattedDeadline}</Text>;

  return (
    <Space direction="vertical" size={4} style={{ width: 170 }}>
      <Tooltip title={`Hạn xử lý: ${formattedDeadline}`}>
        <Progress
          percent={timeline?.percent ?? 0}
          status={timeline?.status || 'normal'}
          size="small"
          showInfo={false}
          strokeColor={status.color === 'error' ? '#ef4444' : status.color === 'warning' ? '#f59e0b' : undefined}
        />
      </Tooltip>
      <Text>{formattedDeadline}</Text>
      <Tag color={status.color} style={{ width: 'fit-content', marginInlineEnd: 0 }}>
        {status.label}
      </Tag>
      {timeline?.hint && <Text type="secondary">{timeline.hint}</Text>}
    </Space>
  );
}

function getWorkflowProgress(item) {
  const approvals = Array.isArray(item.approvals) ? item.approvals : [];
  const grouped = {};

  approvals.forEach((approval) => {
    const stepOrder = Number(approval.step_order || 0);
    if (!stepOrder) return;
    if (!grouped[stepOrder]) grouped[stepOrder] = [];
    grouped[stepOrder].push(approval.status);
  });

  const stepOrders = Object.keys(grouped).map((value) => Number(value));
  const maxStep = stepOrders.length > 0 ? Math.max(...stepOrders) : Number(item.current_step || 1);
  const totalSteps = Math.max(maxStep, Number(item.current_step || 1));

  const approvedSteps = Object.values(grouped).filter(
    (statuses) => statuses.length > 0 && statuses.every((status) => status === 'APPROVED'),
  ).length;

  return {
    approvedSteps,
    totalSteps,
    currentStep: Number(item.current_step || 1),
  };
}

function getNextStepSummary(item, userMap) {
  const approvals = Array.isArray(item.approvals) ? item.approvals : [];
  if (approvals.length === 0) return null;

  const groupedByStep = {};
  approvals.forEach((approval) => {
    const stepOrder = Number(approval.step_order || 0);
    if (!stepOrder) return;
    if (!groupedByStep[stepOrder]) groupedByStep[stepOrder] = [];
    groupedByStep[stepOrder].push(approval);
  });

  const stepOrders = Object.keys(groupedByStep)
    .map((value) => Number(value))
    .sort((a, b) => a - b);

  const nextStepOrder = stepOrders.find((stepOrder) => {
    const approvalsInStep = groupedByStep[stepOrder] || [];
    return approvalsInStep.some((approval) => approval.status !== 'APPROVED');
  });

  if (!nextStepOrder) return null;

  const approverNames = [...new Set(
    (groupedByStep[nextStepOrder] || []).map((approval) => getUserDisplayText(userMap[approval.approver], approval.approver)),
  )].filter(Boolean);

  const shortApproverText = approverNames.length > 2
    ? `${approverNames.slice(0, 2).join(', ')} +${approverNames.length - 2}`
    : approverNames.join(', ');

  return {
    stepOrder: nextStepOrder,
    approverText: shortApproverText,
    approverTooltip: approverNames.join(', '),
  };
}

function getActionableApproval(item, currentUserId) {
  if (!currentUserId || !Array.isArray(item.approvals)) return null;
  return item.approvals.find(
    (approval) =>
      approval.approver === currentUserId
      && approval.status === 'PENDING'
      && Number(approval.step_order) === Number(item.current_step),
  ) || null;
}

function hasApprovalDecision(item) {
  const approvals = Array.isArray(item?.approvals) ? item.approvals : [];
  return approvals.some((approval) => ['APPROVED', 'REJECTED'].includes(approval.status));
}

function canCreatorManageApprovalRequest(item, currentUserId) {
  if (!item || !currentUserId) return false;
  if (item.created_by !== currentUserId) return false;
  if (['APPROVED', 'REJECTED'].includes(item.status)) return false;
  return !hasApprovalDecision(item);
}

function inferEditableFieldInput(fieldName, value) {
  if (typeof value === 'number') return 'number';

  if (value && (isLikelyDateField(fieldName) || isLikelyDateString(String(value)))) {
    const parsed = dayjs(value);
    if (parsed.isValid()) return 'date';
  }

  if (typeof value === 'string' && value.length >= 80) return 'textarea';
  return 'text';
}

function getActorSummary(item, userMap) {
  const approvals = Array.isArray(item.approvals) ? item.approvals : [];
  const approvedUsers = [];
  const rejectedUsers = [];

  approvals.forEach((approval) => {
    const name = getUserDisplayText(userMap[approval.approver], approval.approver);
    if (approval.status === 'APPROVED') approvedUsers.push(name);
    if (approval.status === 'REJECTED') rejectedUsers.push(name);
  });

  return {
    approvedBy: [...new Set(approvedUsers)],
    rejectedBy: [...new Set(rejectedUsers)],
  };
}

function dynamicFieldNode(field) {
  const selectOptions = (field.options || []).map((option) => (
    typeof option === 'object'
      ? { ...option, title: option.label || option.value }
      : { label: option, value: option, title: option }
  ));

  switch (field.input) {
    case 'textarea':
      return <Input.TextArea rows={3} placeholder={`Nhập ${field.label.toLowerCase()}`} />;
    case 'number':
      return <InputNumber min={0} style={{ width: '100%' }} placeholder="Nhập số" />;
    case 'date':
      return <DatePicker style={{ width: '100%' }} format="DD/MM/YYYY" />;
    case 'select':
      return (
        <Select
          showSearch
          optionFilterProp="label"
          popupMatchSelectWidth={false}
          className="erp-form-modal__schema-select"
          popupClassName="erp-form-modal__schema-select-dropdown"
          options={selectOptions}
          placeholder={`Chọn ${field.label.toLowerCase()}`}
        />
      );
    default:
      return <Input placeholder={`Nhập ${field.label.toLowerCase()}`} />;
  }
}

function getSchemaFieldColProps(field) {
  switch (field.input) {
    case 'textarea':
      return { xs: 24, xl: 24 };
    case 'select':
      return { xs: 24, md: 12, xl: 24 };
    case 'date':
    case 'number':
      return { xs: 24, md: 12, xl: 8 };
    default:
      return { xs: 24, md: 12, xl: 12 };
  }
}

function getSchemaFieldClassName(field) {
  return `erp-form-modal__schema-item erp-form-modal__schema-item--${field.input || 'text'}`;
}

function getAttachmentUrl(attachment) {
  const raw = attachment?.file_url || attachment?.file || '';
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (typeof window !== 'undefined') {
    return `${window.location.origin}${raw.startsWith('/') ? '' : '/'}${raw}`;
  }
  return raw;
}

function isImageAttachment(mimeType = '', fileName = '') {
  const normalizedMimeType = String(mimeType).toLowerCase();
  if (normalizedMimeType.startsWith('image/')) return true;
  return /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/i.test(fileName);
}

function isPdfAttachment(mimeType = '', fileName = '') {
  const normalizedMimeType = String(mimeType).toLowerCase();
  if (normalizedMimeType === 'application/pdf') return true;
  return /\.pdf$/i.test(fileName);
}

function triggerDownload(url, fileName = '') {
  if (!url || typeof document === 'undefined') return;
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  if (fileName) {
    anchor.download = fileName;
  }
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

function ApprovalCreateModal({ open, submitting, onSubmit, onCancel }) {
  const [form] = Form.useForm();
  const [templates, setTemplates] = useState([]);
  const [loadingData, setLoadingData] = useState(false);
  const [uploadFiles, setUploadFiles] = useState([]);
  const [templateDescriptionExpanded, setTemplateDescriptionExpanded] = useState(false);
  const [schemaExpanded, setSchemaExpanded] = useState(false);

  useEffect(() => {
    if (!open) return;

    const loadData = async () => {
      setLoadingData(true);
      try {
        const [templateRes] = await Promise.all([
          api.get('/approvals/templates/'),
        ]);
        setTemplates(normalizeList(templateRes.data));
      } catch {
        message.error('Không thể tải dữ liệu tạo approval.');
      } finally {
        setLoadingData(false);
      }
    };

    loadData();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    form.setFieldsValue({
      title: '',
      description: '',
      category: undefined,
      template_id: undefined,
      workflow: undefined,
      priority: 'MEDIUM',
      deadline: null,
      form_data: {},
    });
    setUploadFiles([]);
    setTemplateDescriptionExpanded(false);
    setSchemaExpanded(false);
  }, [form, open]);

  const selectedCategory = Form.useWatch('category', form);
  const selectedTemplateId = Form.useWatch('template_id', form);

  const selectedTemplateGroup = useMemo(
    () => templates.find((group) => group.type === selectedCategory),
    [templates, selectedCategory],
  );

  const templateOptions = useMemo(
    () => (selectedTemplateGroup?.templates || []).map((template) => ({
      value: template.id,
      label: `${template.name}${template.workflow?.name ? ` - ${template.workflow.name}` : ''}`,
    })),
    [selectedTemplateGroup],
  );

  const selectedTemplate = useMemo(
    () => (selectedTemplateGroup?.templates || []).find((template) => Number(template.id) === Number(selectedTemplateId)),
    [selectedTemplateGroup, selectedTemplateId],
  );

  const schemaStats = useMemo(() => {
    const fields = selectedTemplate?.schema || [];
    return {
      total: fields.length,
      required: fields.filter((field) => field.required).length,
      optional: fields.filter((field) => !field.required).length,
    };
  }, [selectedTemplate]);

  const shouldShowDescriptionToggle = useMemo(
    () => String(selectedTemplate?.description || '').trim().length > 180,
    [selectedTemplate],
  );

  const shouldShowSchemaToggle = useMemo(
    () => (selectedTemplate?.schema || []).length > 6,
    [selectedTemplate],
  );

  const visibleSchemaFields = useMemo(() => {
    const fields = selectedTemplate?.schema || [];
    if (schemaExpanded || fields.length <= 6) return fields;
    return fields.slice(0, 6);
  }, [schemaExpanded, selectedTemplate]);

  useEffect(() => {
    if (!selectedTemplate) {
      form.setFieldValue('workflow', undefined);
      setTemplateDescriptionExpanded(false);
      setSchemaExpanded(false);
      return;
    }
    form.setFieldValue('workflow', selectedTemplate.workflow?.id);
    form.setFieldValue('form_data', {});
    setTemplateDescriptionExpanded(false);
    setSchemaExpanded(false);

    const currentTitle = String(form.getFieldValue('title') || '').trim();
    if (!currentTitle) {
      const suggestedTitle = selectedTemplate.name
        ? `${selectedTemplate.name} - ${dayjs().format('DD/MM/YYYY')}`
        : '';
      form.setFieldValue('title', suggestedTitle);
    }
  }, [form, selectedTemplate]);

  const categoryOptions = useMemo(
    () => templates.map((group) => ({
      value: group.type,
      label: CATEGORY_LABELS[group.type] || group.type,
    })),
    [templates],
  );

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      await onSubmit(values, uploadFiles);
      form.resetFields();
      setUploadFiles([]);
    } catch {
      // Validation is shown by Ant Design form.
    }
  };

  const handleCancel = () => {
    form.resetFields();
    setUploadFiles([]);
    onCancel();
  };

  return (
    <Modal
      title={null}
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      okText="Tạo"
      cancelText="Hủy"
      confirmLoading={submitting}
      destroyOnClose
      width={920}
      className="erp-form-modal"
    >
      <Form
        form={form}
        layout="vertical"
        onValuesChange={(changedValues) => {
          if ('category' in changedValues) {
            form.setFieldValue('template_id', undefined);
            form.setFieldValue('workflow', undefined);
            form.setFieldValue('form_data', {});
          }
        }}
      >
        <Form.Item name="workflow" hidden>
          <Input />
        </Form.Item>

        <Row gutter={[12, 12]}>
          <Col xs={24} xl={11}>
            <Card className="erp-form-modal__section erp-form-modal__section--compact" bordered={false}>
              <div className="erp-form-modal__section-header">
                <Title level={5}>Mẫu và quy trình</Title>
              </div>

              <Form.Item label="Loại phê duyệt" name="category" rules={[{ required: true, message: 'Vui lòng chọn loại' }]}>
                <Select options={categoryOptions} loading={loadingData} placeholder="Chọn loại yêu cầu" />
              </Form.Item>

              <Form.Item label="Mẫu phê duyệt" name="template_id" rules={[{ required: true, message: 'Vui lòng chọn mẫu' }]}>
                <Select
                  options={templateOptions}
                  disabled={!selectedCategory}
                  placeholder={selectedCategory ? 'Chọn mẫu phê duyệt' : 'Hãy chọn loại phê duyệt trước'}
                />
              </Form.Item>

              {selectedTemplate?.description && (
                <Alert
                  type="info"
                  showIcon
                  className="erp-form-modal__alert"
                  message="Mô tả mẫu"
                  description={(
                    <div className="erp-form-modal__alert-content">
                      <div className={templateDescriptionExpanded ? '' : 'erp-form-modal__alert-description--collapsed'}>
                        {selectedTemplate.description}
                      </div>
                      {shouldShowDescriptionToggle ? (
                        <Button
                          type="link"
                          size="small"
                          className="erp-form-modal__alert-toggle"
                          onClick={() => setTemplateDescriptionExpanded((current) => !current)}
                        >
                          {templateDescriptionExpanded ? 'Thu gọn' : 'Xem thêm'}
                        </Button>
                      ) : null}
                    </div>
                  )}
                />
              )}

              <Form.Item label="Quy trình áp dụng">
                <Input
                  readOnly
                  value={selectedTemplate?.workflow?.name || ''}
                  placeholder="Workflow sẽ được tự động gán theo mẫu"
                />
              </Form.Item>
            </Card>
          </Col>

          <Col xs={24} xl={13}>
            <Card className="erp-form-modal__section erp-form-modal__section--compact" bordered={false}>
              <div className="erp-form-modal__section-header">
                <Title level={5}>Thông tin tổng quan</Title>
              </div>

              <Form.Item label="Tiêu đề" name="title" rules={[{ required: true, message: 'Vui lòng nhập tiêu đề' }]}>
                <Input placeholder="Ví dụ: Đề nghị phê duyệt mua thiết bị cho phòng kỹ thuật" />
              </Form.Item>

              <Form.Item label="Mô tả" name="description" rules={[{ required: true, message: 'Vui lòng nhập mô tả' }]}>
                <Input.TextArea rows={4} placeholder="Tóm tắt ngắn gọn nội dung, lý do và phạm vi đề nghị phê duyệt" />
              </Form.Item>

              <Row gutter={[12, 0]}>
                <Col xs={24} md={12}>
                  <Form.Item label="Ưu tiên" name="priority" rules={[{ required: true, message: 'Vui lòng chọn mức ưu tiên' }]}>
                    <Select options={PRIORITY_OPTIONS} placeholder="Chọn mức ưu tiên" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    label="Hạn xử lý"
                    name="deadline"
                    rules={[
                      {
                        validator: (_, value) => {
                          if (!value || value.isAfter(dayjs())) {
                            return Promise.resolve();
                          }
                          return Promise.reject(new Error('Hạn xử lý phải lớn hơn thời điểm hiện tại'));
                        },
                      },
                    ]}
                  >
                    <DatePicker showTime style={{ width: '100%' }} placeholder="Chọn hạn xử lý" />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]}>
          {selectedTemplate?.schema?.length > 0 && (
            <Col xs={24}>
              <Card className="erp-form-modal__section erp-form-modal__section--soft erp-form-modal__section--schema" bordered={false}>
                <div className="erp-form-modal__section-header">
                  <Title level={5}>Thông tin theo mẫu</Title>
                </div>

                <div className="erp-form-modal__schema-meta">
                  <Tag color="blue">{schemaStats.total} trường</Tag>
                  <Tag color="cyan">{schemaStats.required} bắt buộc</Tag>
                  {schemaStats.optional > 0 ? <Tag>{schemaStats.optional} tùy chọn</Tag> : null}
                  {shouldShowSchemaToggle ? (
                    <Button
                      type="link"
                      size="small"
                      className="erp-form-modal__schema-toggle"
                      onClick={() => setSchemaExpanded((current) => !current)}
                    >
                      {schemaExpanded ? 'Thu gọn biểu mẫu' : `Xem tất cả ${schemaStats.total} trường`}
                    </Button>
                  ) : null}
                </div>

                <div className="erp-form-modal__schema-fields">
                  <Row gutter={[16, 0]}>
                    {visibleSchemaFields.map((field) => (
                      <Col {...getSchemaFieldColProps(field)} key={field.name}>
                        <Form.Item
                          className={getSchemaFieldClassName(field)}
                          label={field.label}
                          name={['form_data', field.name]}
                          rules={field.required ? [{ required: true, message: `Vui lòng nhập ${field.label.toLowerCase()}` }] : undefined}
                        >
                          {dynamicFieldNode(field)}
                        </Form.Item>
                      </Col>
                    ))}
                  </Row>
                </div>
              </Card>
            </Col>
          )}

          <Col xs={24}>
            <Card className="erp-form-modal__section erp-form-modal__section--soft erp-form-modal__section--upload" bordered={false}>
              <div className="erp-form-modal__section-header">
                <Title level={5}>Hồ sơ đính kèm</Title>
              </div>

              <Form.Item label="Tệp đính kèm" className="erp-form-modal__upload-item">
                <Upload
                  multiple
                  fileList={uploadFiles}
                  beforeUpload={() => false}
                  onChange={({ fileList }) => setUploadFiles(fileList)}
                >
                  <Button icon={<UploadOutlined />}>Chọn file</Button>
                </Upload>
              </Form.Item>
            </Card>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}

export default function ApprovalPage() {
  const screens = Grid.useBreakpoint();
  const currentUserId = getCurrentUserId();
  const [editForm] = Form.useForm();

  const [items, setItems] = useState([]);
  const [userMap, setUserMap] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchKeyword, setSearchKeyword] = useState('');
  const [debouncedSearchKeyword, setDebouncedSearchKeyword] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('ALL');
  const [selectedCategory, setSelectedCategory] = useState('ALL');
  const [onlyMyPendingApprovals, setOnlyMyPendingApprovals] = useState(false);
  const [pagination, setPagination] = useState({
    current: 1,
    pageSize: 10,
    total: 0,
    usesServerPagination: false,
  });

  const [submitting, setSubmitting] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [selectedRequestRowKeys, setSelectedRequestRowKeys] = useState([]);
  const [modalState, setModalState] = useState({ open: false, actionType: 'approve', records: [] });
  const [editModalState, setEditModalState] = useState({ open: false, record: null });
  const [attachmentPreview, setAttachmentPreview] = useState({
    open: false,
    url: '',
    name: '',
    mimeType: '',
  });
  const [detailDrawer, setDetailDrawer] = useState({ open: false, record: null });

  const detailFormEntries = useMemo(() => {
    const formData = detailDrawer.record?.form_data;
    const category = detailDrawer.record?.category;
    if (!formData || typeof formData !== 'object' || Array.isArray(formData)) return [];

    return Object.entries(formData)
      .map(([key, value]) => ({
        key,
        label: getDetailFieldLabel(key, category),
        value: formatDetailValue(value, key, category),
      }))
      .filter((entry) => entry.value !== '-');
  }, [detailDrawer.record]);

  const groupedDetailFormEntries = useMemo(() => {
    if (detailFormEntries.length === 0) return [];

    const groupedMap = detailFormEntries.reduce((acc, entry) => {
      const groupKey = getFormGroup(entry.key, entry.label);
      if (!acc[groupKey]) acc[groupKey] = [];
      acc[groupKey].push(entry);
      return acc;
    }, {});

    const displayOrder = [...FORM_GROUPS.map((group) => group.key), 'other'];

    return displayOrder
      .filter((groupKey) => Array.isArray(groupedMap[groupKey]) && groupedMap[groupKey].length > 0)
      .map((groupKey) => ({
        key: groupKey,
        label: getFormGroupLabel(groupKey),
        entries: groupedMap[groupKey],
      }));
  }, [detailFormEntries]);

  const detailApprovals = useMemo(() => {
    const approvals = detailDrawer.record?.approvals;
    if (!Array.isArray(approvals)) return [];

    return [...approvals].sort((a, b) => {
      const stepA = Number(a.step_order || 0);
      const stepB = Number(b.step_order || 0);
      if (stepA !== stepB) return stepA - stepB;
      return Number(a.id || 0) - Number(b.id || 0);
    });
  }, [detailDrawer.record]);

  const editFormSchema = useMemo(() => {
    const formData = editModalState.record?.form_data;
    const category = editModalState.record?.category;
    if (!formData || typeof formData !== 'object' || Array.isArray(formData)) return [];

    return Object.entries(formData).map(([key, value]) => ({
      key,
      label: getDetailFieldLabel(key, category),
      input: inferEditableFieldInput(key, value),
    }));
  }, [editModalState.record]);

  const tableScrollY = useMemo(() => {
    if (screens.xxl) return '60vh';
    if (screens.xl) return '58vh';
    if (screens.lg) return '54vh';
    if (screens.md) return '48vh';
    return '45vh';
  }, [screens.lg, screens.md, screens.xl, screens.xxl]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearchKeyword(searchKeyword), 300);
    return () => clearTimeout(timer);
  }, [searchKeyword]);

  const loadApprovals = useCallback(async ({ page = 1, pageSize = 10 } = {}) => {
    setLoading(true);
    setError('');

    try {
      const params = { page, type: 'APPROVAL' };
      const normalizedQuery = normalizeSearchText(debouncedSearchKeyword);
      if (normalizedQuery) params.q = normalizedQuery;
      if (selectedStatus !== 'ALL') params.status = selectedStatus;
      if (onlyMyPendingApprovals) params.needs_my_approval = '1';

      const response = await api.get('/requests/', { params });
      const requests = normalizeList(response.data);
      setItems(requests);
      setSelectedRequestRowKeys((prev) => prev.filter((key) => requests.some((item) => item.id === key)));

      const paging = normalizePagination(response.data, page, pageSize);
      setPagination((prev) => ({
        ...prev,
        ...paging,
        current: paging.usesServerPagination ? page : 1,
      }));
    } catch {
      setError('Không thể tải danh sách approval. Vui lòng thử lại.');
      setItems([]);
      setPagination((prev) => ({ ...prev, total: 0, current: 1 }));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearchKeyword, onlyMyPendingApprovals, selectedStatus]);

  useEffect(() => {
    loadApprovals({ page: 1, pageSize: pagination.pageSize });
  }, [debouncedSearchKeyword, onlyMyPendingApprovals, selectedStatus, loadApprovals, pagination.pageSize]);

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

  const openActionModal = (record, actionType) => {
    const actionableApproval = getActionableApproval(record, currentUserId);
    if (!actionableApproval) return;
    setModalState({ open: true, actionType, records: [actionableApproval] });
  };

  const actionableApprovalByRequestId = useMemo(() => {
    const mapped = {};
    items.forEach((item) => {
      const actionable = getActionableApproval(item, currentUserId);
      if (actionable && !['APPROVED', 'REJECTED'].includes(item.status)) {
        mapped[item.id] = actionable;
      }
    });
    return mapped;
  }, [items, currentUserId]);

  const selectedActionableApprovals = useMemo(
    () => selectedRequestRowKeys
      .map((requestId) => actionableApprovalByRequestId[requestId])
      .filter(Boolean),
    [selectedRequestRowKeys, actionableApprovalByRequestId],
  );

  const openBulkActionModal = (actionType) => {
    if (selectedActionableApprovals.length === 0) {
      message.warning('Không có yêu cầu hợp lệ để thao tác hàng loạt.');
      return;
    }
    setModalState({
      open: true,
      actionType,
      records: selectedActionableApprovals,
    });
  };

  const closeActionModal = () => {
    setModalState((prev) => ({ ...prev, open: false, records: [] }));
  };

  const submitAction = async (note) => {
    if (!Array.isArray(modalState.records) || modalState.records.length === 0) return;

    const endpoint = modalState.actionType === 'approve' ? 'approve' : 'reject';

    setSubmitting(true);
    try {
      const settled = await Promise.allSettled(
        modalState.records.map((record) => api.post(`/approvals/${record.id}/${endpoint}/`, { note })),
      );
      const successCount = settled.filter((result) => result.status === 'fulfilled').length;
      const failedCount = settled.length - successCount;

      if (successCount > 0 && failedCount === 0) {
        message.success(
          modalState.actionType === 'approve'
            ? `Đã duyệt ${successCount} yêu cầu thành công`
            : `Đã từ chối ${successCount} yêu cầu thành công`,
        );
      } else if (successCount > 0) {
        message.warning(`Đã xử lý ${successCount} yêu cầu, ${failedCount} yêu cầu thất bại.`);
      } else {
        message.error('Xử lý phê duyệt thất bại');
      }

      setSelectedRequestRowKeys([]);
      closeActionModal();
      loadApprovals({ page: pagination.current, pageSize: pagination.pageSize });
    } catch {
      message.error('Xử lý phê duyệt thất bại');
    } finally {
      setSubmitting(false);
    }
  };

  const openAttachmentPreview = (attachment) => {
    const url = getAttachmentUrl(attachment);
    if (!url) {
      message.error('Không tìm thấy URL tệp đính kèm');
      return;
    }

    setAttachmentPreview({
      open: true,
      url,
      name: attachment?.file_name || 'tep-dinh-kem',
      mimeType: attachment?.mime_type || '',
    });
  };

  const closeAttachmentPreview = () => {
    setAttachmentPreview({
      open: false,
      url: '',
      name: '',
      mimeType: '',
    });
  };

  const openDetailDrawer = (record) => {
    setDetailDrawer({ open: true, record });
  };

  const closeDetailDrawer = () => {
    setDetailDrawer({ open: false, record: null });
  };

  const openEditModal = (record) => {
    if (!canCreatorManageApprovalRequest(record, currentUserId)) {
      message.warning('Chỉ người tạo và khi chưa có ai duyệt mới có thể sửa yêu cầu.');
      return;
    }

    const formData = record?.form_data || {};
    const normalizedFormData = Object.entries(formData).reduce((acc, [key, value]) => {
      const inputType = inferEditableFieldInput(key, value);
      if (inputType === 'date') {
        const parsed = dayjs(value);
        acc[key] = parsed.isValid() ? parsed : null;
      } else {
        acc[key] = value;
      }
      return acc;
    }, {});

    editForm.setFieldsValue({
      title: record.title || '',
      description: record.description || '',
      priority: record.priority || 'MEDIUM',
      deadline: record.deadline ? dayjs(record.deadline) : null,
      notes: record.notes || '',
      form_data: normalizedFormData,
    });

    setEditModalState({ open: true, record });
  };

  const closeEditModal = () => {
    editForm.resetFields();
    setEditModalState({ open: false, record: null });
  };

  const submitEditRequest = async () => {
    if (!editModalState.record?.id) return;

    try {
      const values = await editForm.validateFields();
      const normalizedFormData = Object.entries(values.form_data || {}).reduce((acc, [key, rawValue]) => {
        if (dayjs.isDayjs(rawValue)) {
          acc[key] = rawValue.toISOString();
        } else {
          acc[key] = rawValue;
        }
        return acc;
      }, {});

      setEditSubmitting(true);
      await api.patch(`/requests/${editModalState.record.id}/`, {
        title: values.title,
        description: values.description,
        priority: values.priority,
        deadline: values.deadline ? values.deadline.toISOString() : null,
        notes: values.notes || '',
        form_data: normalizedFormData,
      });

      message.success('Đã cập nhật yêu cầu phê duyệt');

      if (detailDrawer.record?.id === editModalState.record.id) {
        setDetailDrawer({ open: false, record: null });
      }

      closeEditModal();
      loadApprovals({ page: pagination.current, pageSize: pagination.pageSize });
    } catch (editError) {
      const detail = editError?.response?.data?.detail || 'Cập nhật yêu cầu thất bại';
      message.error(detail);
    } finally {
      setEditSubmitting(false);
    }
  };

  const handleDeleteRequest = async (record) => {
    if (!record?.id) return;

    if (!canCreatorManageApprovalRequest(record, currentUserId)) {
      message.warning('Chỉ người tạo và khi chưa có ai duyệt mới có thể xóa yêu cầu.');
      return;
    }

    try {
      await api.delete(`/requests/${record.id}/`);
      message.success('Đã xóa yêu cầu phê duyệt');

      setSelectedRequestRowKeys((prev) => prev.filter((id) => id !== record.id));
      if (detailDrawer.record?.id === record.id) {
        setDetailDrawer({ open: false, record: null });
      }

      loadApprovals({ page: pagination.current, pageSize: pagination.pageSize });
    } catch (deleteError) {
      const detail = deleteError?.response?.data?.detail || 'Xóa yêu cầu thất bại';
      message.error(detail);
    }
  };

  const handleDownloadAttachment = (attachment) => {
    const url = getAttachmentUrl(attachment);
    if (!url) {
      message.error('Không tìm thấy URL tệp đính kèm');
      return;
    }
    triggerDownload(url, attachment?.file_name || 'tep-dinh-kem');
  };

  const handleCreateApproval = async (values, uploadFileList) => {
    setCreateSubmitting(true);
    try {
      const normalizedFormData = Object.entries(values.form_data || {}).reduce((acc, [key, rawValue]) => {
        if (dayjs.isDayjs(rawValue)) {
          acc[key] = rawValue.toISOString();
        } else {
          acc[key] = rawValue;
        }
        return acc;
      }, {});

      const requestPayload = {
        type: 'APPROVAL',
        title: values.title,
        description: values.description,
        category: values.category,
        form_data: normalizedFormData,
        priority: values.priority,
        workflow: Number(values.workflow),
        deadline: values.deadline ? values.deadline.toISOString() : null,
      };

      const createdResponse = await api.post('/requests/', requestPayload);
      const createdRequestId = createdResponse?.data?.id;

      if (createdRequestId && Array.isArray(uploadFileList) && uploadFileList.length > 0) {
        const formData = new FormData();
        uploadFileList.forEach((file) => {
          if (file.originFileObj) {
            formData.append('files', file.originFileObj);
          }
        });

        if (formData.has('files')) {
          await api.post(`/requests/${createdRequestId}/attachments/`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
          });
        }
      }

      message.success('Đã tạo yêu cầu phê duyệt mới');
      setCreateModalOpen(false);
      loadApprovals({ page: 1, pageSize: pagination.pageSize });
    } catch (createError) {
      const detail = createError?.response?.data?.detail
        || createError?.response?.data?.workflow?.[0]
        || 'Tạo yêu cầu phê duyệt thất bại';
      message.error(detail);
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleTableChange = (nextPagination) => {
    const page = nextPagination?.current || 1;
    const pageSize = nextPagination?.pageSize || pagination.pageSize;
    setPagination((prev) => ({ ...prev, current: page, pageSize }));
    loadApprovals({ page, pageSize });
  };

  const compactActionButtonStyle = useMemo(
    () => (screens.md
      ? undefined
      : {
        width: 32,
        height: 32,
        padding: 0,
        borderRadius: 10,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
      }),
    [screens.md],
  );

  const filteredItems = useMemo(
    () => selectedCategory === 'ALL' ? items : items.filter((item) => item.category === selectedCategory),
    [items, selectedCategory],
  );

  const tabCounts = useMemo(() => {
    const counts = { ALL: items.length, PURCHASE: 0, LEAVE: 0, DOCUMENT: 0, TASK: 0 };
    items.forEach((item) => { if (counts[item.category] !== undefined) counts[item.category] += 1; });
    return counts;
  }, [items]);

  const getFormDataValue = useCallback((record, ...keys) => {
    const formData = record?.form_data;
    if (!formData || typeof formData !== 'object') return '';
    // First pass: exact match (case-insensitive, trimmed)
    for (const key of keys) {
      const target = key.trim().toLowerCase();
      const found = Object.keys(formData).find((k) => k.trim().toLowerCase() === target);
      if (found && formData[found] !== undefined && formData[found] !== null && formData[found] !== '') {
        return formData[found];
      }
    }
    // Second pass: normalized (strip spaces, underscores, hyphens)
    const normalize = (s) => s.toLowerCase().replace(/[\s_\-]+/g, '');
    for (const key of keys) {
      const target = normalize(key);
      const found = Object.keys(formData).find((k) => normalize(k) === target);
      if (found && formData[found] !== undefined && formData[found] !== null && formData[found] !== '') {
        return formData[found];
      }
    }
    return '';
  }, []);

  const colTitle = useMemo(() => ({
    title: 'Yêu cầu',
    dataIndex: 'title',
    key: 'title',
    width: 240,
    render: (value, record) => (
      <Button
        type="link"
        className="approval-title-button"
        onClick={() => openDetailDrawer(record)}
        style={{ padding: 0, height: 'auto', fontWeight: 600 }}
      >
        <span>{value || `Yêu cầu #${record.id}`}</span>
        <EyeOutlined className="approval-title-button__icon" />
      </Button>
    ),
  }), []);

  const colCategory = useMemo(() => ({
    title: 'Loại',
    dataIndex: 'category',
    key: 'category',
    width: 130,
    render: (value) => CATEGORY_LABELS[value] || value || '-',
  }), []);

  const colCreatedBy = useMemo(() => ({
    title: 'Người tạo',
    dataIndex: 'created_by',
    key: 'created_by',
    width: 180,
    render: (value) => getUserDisplayText(userMap[value], value),
  }), [userMap]);

  const colStatus = useMemo(() => ({
    title: 'Trạng thái',
    dataIndex: 'status',
    key: 'status',
    width: 140,
    render: (status) => {
      const meta = getRequestStatusMeta(status);
      return <Tag className={`status-tag status-tag--${meta.tone}`}>{meta.label}</Tag>;
    },
  }), []);

  const colProgress = useMemo(() => ({
    title: 'Tiến độ duyệt',
    key: 'progress',
    width: 250,
    render: (_, record) => {
      const progress = getWorkflowProgress(record);
      const nextStep = getNextStepSummary(record, userMap);
      const percent = progress.totalSteps > 0
        ? Math.round((progress.approvedSteps / progress.totalSteps) * 100)
        : 0;
      return (
        <Space direction="vertical" size={4} style={{ width: 220 }}>
          <Progress
            percent={percent}
            status={record.status === 'REJECTED' ? 'exception' : 'active'}
            size="small"
            format={() => `${progress.approvedSteps}/${progress.totalSteps}`}
          />
          {record.status === 'APPROVED' ? (
            <Text type="secondary">Quy trình đã hoàn tất</Text>
          ) : record.status === 'REJECTED' ? (
            <Text type="secondary">Quy trình đã bị từ chối</Text>
          ) : nextStep ? (
            <Tooltip
              title={nextStep.approverTooltip ? `Người duyệt: ${nextStep.approverTooltip}` : undefined}
            >
              <Text type="secondary">
                Bước tiếp theo: {nextStep.stepOrder}
                {nextStep.approverText ? ` (${nextStep.approverText})` : ''}
              </Text>
            </Tooltip>
          ) : (
            <Text type="secondary">Bước hiện tại: {progress.currentStep}</Text>
          )}
        </Space>
      );
    },
  }), [userMap]);

  const colAttachments = useMemo(() => ({
    title: 'Tệp đính kèm',
    dataIndex: 'attachments',
    key: 'attachments',
    width: 240,
    render: (attachments) => {
      const list = Array.isArray(attachments) ? attachments : [];
      if (list.length === 0) {
        return <Text type="secondary">-</Text>;
      }

      return (
        <Space direction="vertical" size={4}>
          {list.slice(0, 2).map((attachment) => (
            <Space key={attachment.id || attachment.file_name} size={6} wrap>
              <Text ellipsis style={{ maxWidth: 120 }} title={attachment.file_name || 'tep-dinh-kem'}>
                {attachment.file_name || 'tep-dinh-kem'}
              </Text>
              <Button size="small" onClick={() => openAttachmentPreview(attachment)}>
                Xem trước
              </Button>
              <Button size="small" onClick={() => handleDownloadAttachment(attachment)}>
                Tải
              </Button>
            </Space>
          ))}
          {list.length > 2 && <Text type="secondary">+{list.length - 2} tệp khác</Text>}
        </Space>
      );
    },
  }), []);

  const colDeadline = useMemo(() => ({
    title: 'Hạn xử lý',
    key: 'deadline',
    width: 220,
    render: (_, record) => renderDeadline(record.deadline, record.created_at),
  }), []);

  const colUpdatedAt = useMemo(() => ({
    title: 'Cập nhật',
    dataIndex: 'updated_at',
    key: 'updated_at',
    width: 170,
    render: (value) => (value ? dayjs(value).format('DD/MM/YYYY HH:mm') : '-'),
  }), []);

  const colActions = useMemo(() => ({
    title: 'Hành động',
    key: 'actions',
    width: 420,
    render: (_, record) => {
      const actionable = getActionableApproval(record, currentUserId);
      const canManage = canCreatorManageApprovalRequest(record, currentUserId);

      return (
        <Space size={screens.md ? 'small' : 4}>
          <Tooltip title="Xem chi tiết">
            <Button
              type="text"
              icon={<EyeOutlined />}
              onClick={() => openDetailDrawer(record)}
              style={{
                ...compactActionButtonStyle,
                borderRadius: 999,
                color: '#1d4ed8',
                background: '#f8fbff',
                border: '1px solid #dbe3f0',
                boxShadow: 'none',
              }}
            />
          </Tooltip>
          {canManage && (
            <Tooltip title="Sửa yêu cầu">
              <Button
                icon={<EditOutlined />}
                onClick={() => openEditModal(record)}
                style={compactActionButtonStyle}
              >
                {screens.md ? 'Sửa' : null}
              </Button>
            </Tooltip>
          )}
          {canManage && (
            <Popconfirm
              title="Xóa yêu cầu này?"
              description="Bạn chỉ có thể xóa khi chưa có ai duyệt."
              okText="Xóa"
              cancelText="Hủy"
              okButtonProps={{ danger: true }}
              onConfirm={() => handleDeleteRequest(record)}
            >
              <Tooltip title="Xóa yêu cầu">
                <Button
                  danger
                  icon={<DeleteOutlined />}
                  style={compactActionButtonStyle}
                >
                  {screens.md ? 'Xóa' : null}
                </Button>
              </Tooltip>
            </Popconfirm>
          )}
          {(actionable && !['APPROVED', 'REJECTED'].includes(record.status)) && (
            <>
          <Tooltip title="Duyệt nhanh">
            <Button
              type="primary"
              icon={<CheckOutlined />}
              onClick={() => openActionModal(record, 'approve')}
              style={compactActionButtonStyle}
            >
              {screens.md ? 'Duyệt' : null}
            </Button>
          </Tooltip>
          <Tooltip title="Từ chối nhanh">
            <Button
              danger
              icon={<CloseOutlined />}
              onClick={() => openActionModal(record, 'reject')}
              style={compactActionButtonStyle}
            >
              {screens.md ? 'Từ chối' : null}
            </Button>
          </Tooltip>
            </>
          )}
        </Space>
      );
    },
  }), [currentUserId, screens.md, compactActionButtonStyle, detailDrawer.record?.id, pagination.current, pagination.pageSize]);

  const columns = useMemo(() => {
    if (selectedCategory === 'PURCHASE') {
      const colSanPham = {
        title: 'Sản phẩm',
        key: 'purchase_product',
        width: 220,
        fixed: 'left',
        render: (_, record) => {
          const val = getFormDataValue(record, 'Tên sản phẩm', 'product_name', 'item_name', 'item', 'ten_san_pham', 'san_pham', 'productName', 'ten_hang_muc', 'hang_muc');
          return val ? <Text strong>{String(val)}</Text> : <Text type="secondary">-</Text>;
        },
      };
      const colDonGia = {
        title: 'Đơn giá',
        key: 'purchase_price',
        width: 150,
        align: 'right',
        render: (_, record) => {
          const val = getFormDataValue(record, 'Giá', 'Đơn giá', 'unit_price', 'price', 'don_gia', 'gia', 'unitPrice');
          if (!val && val !== 0) return <Text type="secondary">-</Text>;
          const num = Number(val);
          return !Number.isNaN(num)
            ? <Text>{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(num)}</Text>
            : <Text>{String(val)}</Text>;
        },
      };
      const colSoLuong = {
        title: 'Số lượng',
        key: 'purchase_qty',
        width: 100,
        align: 'center',
        render: (_, record) => {
          const val = getFormDataValue(record, 'Số lượng', 'Số lượng ', 'quantity', 'so_luong', 'qty');
          return val ? <Text>{String(val)}</Text> : <Text type="secondary">-</Text>;
        },
      };
      const colVAT = {
        title: 'VAT',
        key: 'purchase_vat',
        width: 90,
        align: 'center',
        render: (_, record) => {
          const val = getFormDataValue(record, 'vat', 'tax', 'thue', 'vat_percent', 'tax_rate', 'thue_suat');
          if (!val && val !== 0) return <Text type="secondary">-</Text>;
          const num = Number(val);
          if (!Number.isNaN(num)) {
            return <Text>{num > 1 ? `${num}%` : `${Math.round(num * 100)}%`}</Text>;
          }
          return <Text>{String(val)}</Text>;
        },
      };
      const colTongTien = {
        title: 'Tổng tiền',
        key: 'purchase_total',
        width: 170,
        align: 'right',
        className: 'approval-col-amount',
        render: (_, record) => {
          const val = getFormDataValue(record, 'Tổng tiền', 'total_amount', 'amount', 'tong_tien', 'tong_chi_phi', 'totalAmount', 'total');
          if (!val && val !== 0) return <Text type="secondary">-</Text>;
          const num = Number(val);
          return !Number.isNaN(num)
            ? <Text strong className="approval-amount-highlight">{new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(num)}</Text>
            : <Text strong>{String(val)}</Text>;
        },
      };
      const colNhaCungCap = {
        title: 'Nhà cung cấp',
        key: 'purchase_vendor',
        width: 180,
        render: (_, record) => {
          const val = getFormDataValue(record, 'Tên nhà cung cấp', 'vendor', 'supplier', 'nha_cung_cap', 'ten_nha_cung_cap', 'supplierName', 'vendorName');
          return val ? <Text>{String(val)}</Text> : <Text type="secondary">-</Text>;
        },
      };

      return [
        colSanPham,
        colDonGia,
        colSoLuong,
        colVAT,
        colTongTien,
        colNhaCungCap,
        colCreatedBy,
        colProgress,
        colAttachments,
        colDeadline,
        colUpdatedAt,
        colActions,
      ];
    }

    const base = [colTitle];

    if (selectedCategory === 'ALL') {
      base.push(colCategory);
    }

    base.push(colCreatedBy, colStatus);

    if (selectedCategory === 'LEAVE') {
      base.push(
        {
          title: 'Lý do nghỉ',
          key: 'leave_reason',
          width: 200,
          render: (_, record) => {
            const val = getFormDataValue(record, 'Lý do nghỉ', 'leave_reason', 'reason_leave', 'reason', 'ly_do', 'ly_do_nghi', 'leaveReason');
            if (!val) return <Text type="secondary">-</Text>;
            const translated = getDetailValueLabel(String(val), 'leave_reason', 'LEAVE');
            return <Text>{translated || String(val)}</Text>;
          },
        },
        {
          title: 'Từ ngày',
          key: 'leave_start',
          width: 150,
          render: (_, record) => {
            const val = getFormDataValue(record, 'Ngày bắt đầu nghỉ', 'Ngày bắt đầu', 'from_date', 'start_date', 'ngay_bat_dau', 'fromDate', 'startDate');
            if (!val) return <Text type="secondary">-</Text>;
            const parsed = dayjs(val);
            return parsed.isValid() ? <Text>{parsed.format('DD/MM/YYYY')}</Text> : <Text>{String(val)}</Text>;
          },
        },
        {
          title: 'Đến ngày',
          key: 'leave_end',
          width: 150,
          render: (_, record) => {
            const val = getFormDataValue(record, 'Ngày kết thúc nghỉ', 'Ngày kết thúc', 'to_date', 'end_date', 'ngay_ket_thuc', 'toDate', 'endDate');
            if (!val) return <Text type="secondary">-</Text>;
            const parsed = dayjs(val);
            return parsed.isValid() ? <Text>{parsed.format('DD/MM/YYYY')}</Text> : <Text>{String(val)}</Text>;
          },
        },
      );
    }

    base.push(colProgress);

    base.push(colDeadline, colUpdatedAt, colActions);
    return base;
  }, [selectedCategory, colTitle, colCategory, colCreatedBy, colStatus, colProgress, colAttachments, colDeadline, colUpdatedAt, colActions, getFormDataValue]);

  const rowSelection = useMemo(
    () => ({
      selectedRowKeys: selectedRequestRowKeys,
      onChange: (nextSelectedKeys) => setSelectedRequestRowKeys(nextSelectedKeys),
      getCheckboxProps: (record) => ({
        disabled: !actionableApprovalByRequestId[record.id],
      }),
      renderCell: (checked, record, index, originNode) => {
        if (onlyMyPendingApprovals && !actionableApprovalByRequestId[record.id]) {
          return null;
        }
        return originNode;
      },
    }),
    [selectedRequestRowKeys, actionableApprovalByRequestId, onlyMyPendingApprovals],
  );

  const selectedCount = selectedRequestRowKeys.length;
  const bulkActionableCount = selectedActionableApprovals.length;

  return (
    <div className="fixed-list-page approval-page" data-tab={selectedCategory}>
      <Space direction="vertical" size="small" style={{ width: '100%' }} className="fixed-list-page-header approval-list-header">
        <Space style={{ width: '100%', justifyContent: 'space-between' }} align="start" className="list-page-titlebar">
          <div>
            <Title level={4} style={{ margin: 0 }}>
              Trang Phê Duyệt
            </Title>
            {screens.md && <Text type="secondary">Theo dõi và quản lý toàn bộ các yêu cầu phê duyệt trong hệ thống</Text>}
          </div>
          <Button type="primary" onClick={() => setCreateModalOpen(true)}>
            Tạo yêu cầu phê duyệt
          </Button>
        </Space>

        {error && <Alert type="error" message={error} showIcon />}

        <Tabs
          className="approval-category-tabs"
          activeKey={selectedCategory}
          onChange={(key) => {
            setSelectedCategory(key);
            setSelectedRequestRowKeys([]);
            setPagination((prev) => ({ ...prev, current: 1 }));
          }}
          items={[
            { key: 'ALL', label: <span><AppstoreOutlined /> Tất cả ({tabCounts.ALL})</span> },
            { key: 'PURCHASE', label: <span><ShoppingCartOutlined /> Mua sắm ({tabCounts.PURCHASE})</span> },
            { key: 'LEAVE', label: <span><CalendarOutlined /> Nghỉ phép ({tabCounts.LEAVE})</span> },
            { key: 'DOCUMENT', label: <span><FileTextOutlined /> Chứng từ ({tabCounts.DOCUMENT})</span> },
            { key: 'TASK', label: <span>Công việc ({tabCounts.TASK})</span> },
          ]}
        />

        <div className="list-page-filterbar">
          <Space wrap align="center" style={{ width: '100%', justifyContent: 'space-between' }}>
            <Input.Search
              allowClear
              placeholder="Tìm theo tiêu đề hoặc người tạo"
              value={searchKeyword}
              onChange={(event) => setSearchKeyword(event.target.value)}
              style={{ maxWidth: 460 }}
            />
            <Space wrap>
              <Select
                value={selectedStatus}
                options={APPROVAL_STATUS_OPTIONS}
                style={{ width: 190 }}
                onChange={(value) => {
                  setSelectedStatus(value);
                  setSelectedRequestRowKeys([]);
                }}
              />
              <Checkbox
                checked={onlyMyPendingApprovals}
                onChange={(event) => {
                  setOnlyMyPendingApprovals(event.target.checked);
                  setSelectedRequestRowKeys([]);
                }}
              >
                Chỉ hiển thị yêu cầu cần tôi duyệt
              </Checkbox>
              <Button
                onClick={() => {
                  setSearchKeyword('');
                  setSelectedStatus('ALL');
                  setSelectedCategory('ALL');
                  setOnlyMyPendingApprovals(false);
                  setSelectedRequestRowKeys([]);
                }}
              >
                Đặt lại lọc
              </Button>
            </Space>
          </Space>
        </div>

        {selectedCount > 0 && (
          <Alert
            type="info"
            showIcon
            message={`Đã chọn ${selectedCount} yêu cầu (${bulkActionableCount} yêu cầu có thể thao tác)`}
            action={(
              <Space wrap>
                <Button
                  type="primary"
                  icon={<CheckOutlined />}
                  onClick={() => openBulkActionModal('approve')}
                  disabled={bulkActionableCount === 0}
                >
                  Duyệt đã chọn
                </Button>
                <Button
                  danger
                  icon={<CloseOutlined />}
                  onClick={() => openBulkActionModal('reject')}
                  disabled={bulkActionableCount === 0}
                >
                  Từ chối đã chọn
                </Button>
                <Button onClick={() => setSelectedRequestRowKeys([])}>Bỏ chọn</Button>
              </Space>
            )}
          />
        )}

      </Space>

      <div className="fixed-list-table approval-list-table">
        <Table
          rowKey="id"
          rowSelection={rowSelection}
          loading={loading}
          columns={columns}
          dataSource={filteredItems}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: filteredItems.length,
            showSizeChanger: false,
          }}
          onChange={handleTableChange}
          scroll={{ x: selectedCategory === 'PURCHASE' ? 2400 : selectedCategory === 'LEAVE' ? 2100 : 1860, y: tableScrollY }}
          sticky
          size="middle"
        />
      </div>

      <Modal
        title={attachmentPreview.name ? `Xem tệp: ${attachmentPreview.name}` : 'Xem tệp đính kèm'}
        open={attachmentPreview.open}
        onCancel={closeAttachmentPreview}
        footer={[
          <Button
            key="download"
            onClick={() => triggerDownload(attachmentPreview.url, attachmentPreview.name || 'tep-dinh-kem')}
          >
            Tải xuống
          </Button>,
          <Button key="close" type="primary" onClick={closeAttachmentPreview}>
            Đóng
          </Button>,
        ]}
        width={900}
        destroyOnClose
      >
        {isImageAttachment(attachmentPreview.mimeType, attachmentPreview.name) && (
          <img
            alt={attachmentPreview.name || 'attachment-preview'}
            src={attachmentPreview.url}
            style={{ width: '100%', maxHeight: '70vh', objectFit: 'contain' }}
          />
        )}

        {!isImageAttachment(attachmentPreview.mimeType, attachmentPreview.name)
          && isPdfAttachment(attachmentPreview.mimeType, attachmentPreview.name) && (
            <iframe
              src={attachmentPreview.url}
              title={attachmentPreview.name || 'pdf-preview'}
              style={{ width: '100%', height: '70vh', border: 0 }}
            />
        )}

        {!isImageAttachment(attachmentPreview.mimeType, attachmentPreview.name)
          && !isPdfAttachment(attachmentPreview.mimeType, attachmentPreview.name) && (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Alert
                type="info"
                showIcon
                message="Định dạng tệp này không hỗ trợ xem trước trực tiếp"
                description="Hãy bấm Tải xuống để mở tệp bằng ứng dụng phù hợp trên máy của bạn."
              />
              <Button onClick={() => triggerDownload(attachmentPreview.url, attachmentPreview.name || 'tep-dinh-kem')}>
                Tải tệp này
              </Button>
            </Space>
        )}
      </Modal>

      <Drawer
        title="Chi tiết yêu cầu phê duyệt"
        open={detailDrawer.open}
        onClose={closeDetailDrawer}
        width={640}
      >
        {detailDrawer.record && (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div style={{ padding: 16, borderRadius: 18, border: '1px solid #e6eef8', background: 'linear-gradient(180deg, #fbfdff 0%, #f6faff 100%)' }}>
              <Title level={5} style={{ margin: '0 0 4px' }}>{detailDrawer.record.title}</Title>
              <Space wrap>
                <Tag color="blue">{CATEGORY_LABELS[detailDrawer.record.category] || detailDrawer.record.category || '-'}</Tag>
                <Tag className={`status-tag status-tag--${getRequestStatusMeta(detailDrawer.record.status).tone}`}>
                  {getRequestStatusMeta(detailDrawer.record.status).label}
                </Tag>
              </Space>
            </div>

            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <div>
                <Text strong>Người tạo:</Text>
                <Text> {getUserDisplayText(userMap[detailDrawer.record.created_by], detailDrawer.record.created_by)}</Text>
              </div>
              {detailDrawer.record.description && (
                <div>
                  <Text strong>Mô tả:</Text>
                  <div style={{ marginTop: 6 }}>
                    <Text>{detailDrawer.record.description}</Text>
                  </div>
                </div>
              )}
              <div>
                <Text strong>Tiến độ:</Text>
                <div style={{ marginTop: 8, maxWidth: 260 }}>
                  {(() => {
                    const progress = getWorkflowProgress(detailDrawer.record);
                    const percent = progress.totalSteps > 0
                      ? Math.round((progress.approvedSteps / progress.totalSteps) * 100)
                      : 0;
                    return (
                      <Progress
                        percent={percent}
                        size="small"
                        format={() => `${progress.approvedSteps}/${progress.totalSteps}`}
                        status={detailDrawer.record.status === 'REJECTED' ? 'exception' : 'active'}
                      />
                    );
                  })()}
                </div>
              </div>
              <div>
                <Text strong>Hạn xử lý:</Text>
                <div style={{ marginTop: 8 }}>{renderDeadline(detailDrawer.record.deadline, detailDrawer.record.created_at)}</div>
              </div>
              {detailDrawer.record.notes && (
                <div>
                  <Text strong>Ghi chú:</Text>
                  <div style={{ marginTop: 6 }}>
                    <Text>{detailDrawer.record.notes}</Text>
                  </div>
                </div>
              )}
              {detailFormEntries.length > 0 && (
                <div className="approval-detail-panel">
                  <Text strong>Thông tin chi tiết:</Text>
                  <div style={{ marginTop: 8, border: '1px solid #eef2f7', borderRadius: 14, padding: 12, background: '#fafcff' }}>
                    <Collapse
                      bordered={false}
                      size="small"
                      defaultActiveKey={groupedDetailFormEntries[0] ? [groupedDetailFormEntries[0].key] : []}
                      items={groupedDetailFormEntries.map((group) => ({
                        key: group.key,
                        label: (
                          <Text className="approval-detail-group-title">
                            {group.label}
                          </Text>
                        ),
                        children: (
                          <div style={{ borderRadius: 10, background: '#fff', border: '1px solid #edf1f6', padding: '8px 10px' }}>
                            <Space direction="vertical" size={8} style={{ width: '100%' }}>
                              {group.entries.map((entry) => (
                                <div key={entry.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                                  <Text className="approval-detail-field-label">{entry.label}</Text>
                                  <Text className="approval-detail-field-value" style={{ textAlign: 'right' }}>{entry.value}</Text>
                                </div>
                              ))}
                            </Space>
                          </div>
                        ),
                      }))}
                    />
                  </div>
                </div>
              )}
              {detailApprovals.length > 0 && (
                <div>
                  <Text strong>Danh sách phê duyệt:</Text>
                  <div style={{ marginTop: 8, border: '1px solid #eef2f7', borderRadius: 14, background: '#fff', overflow: 'hidden' }}>
                    <Space direction="vertical" size={0} style={{ width: '100%' }}>
                      {detailApprovals.map((approval, index) => {
                        const approvalStatus = getRequestStatusMeta(approval.status === 'PENDING' ? 'PENDING_APPROVAL' : approval.status);
                        return (
                          <div
                            key={approval.id}
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'auto 1fr auto',
                              alignItems: 'center',
                              gap: 10,
                              padding: '9px 12px',
                              borderBottom: index === detailApprovals.length - 1 ? 'none' : '1px solid #f1f5f9',
                              background: '#fff',
                            }}
                          >
                            <Tag color="default" style={{ marginInlineEnd: 0 }}>
                              Bước {approval.step_order || '-'}
                            </Tag>
                            <Text ellipsis>{getUserDisplayText(userMap[approval.approver], approval.approver)}</Text>
                            <Tag className={`status-tag status-tag--${approvalStatus.tone}`} style={{ marginInlineEnd: 0 }}>
                              {approvalStatus.label}
                            </Tag>
                          </div>
                        );
                      })}
                    </Space>
                  </div>
                </div>
              )}
              {Array.isArray(detailDrawer.record.attachments) && detailDrawer.record.attachments.length > 0 && (
                <div>
                  <Text strong>Tệp đính kèm:</Text>
                  <Space direction="vertical" size={8} style={{ width: '100%', marginTop: 8 }}>
                    {detailDrawer.record.attachments.map((attachment) => (
                      <Space key={attachment.id || attachment.file_name} wrap>
                        <Text>{attachment.file_name || 'tep-dinh-kem'}</Text>
                        <Button size="small" onClick={() => openAttachmentPreview(attachment)}>Xem trước</Button>
                        <Button size="small" onClick={() => handleDownloadAttachment(attachment)}>Tải</Button>
                      </Space>
                    ))}
                  </Space>
                </div>
              )}
            </Space>
          </Space>
        )}
      </Drawer>

      <ApprovalActionModal
        open={modalState.open}
        actionType={modalState.actionType}
        actionCount={modalState.records.length}
        submitting={submitting}
        onSubmit={submitAction}
        onCancel={closeActionModal}
      />

      <Modal
        title="Sửa yêu cầu phê duyệt"
        open={editModalState.open}
        onOk={submitEditRequest}
        onCancel={closeEditModal}
        okText="Lưu thay đổi"
        cancelText="Hủy"
        confirmLoading={editSubmitting}
        destroyOnClose
        width={760}
      >
        <Form form={editForm} layout="vertical">
          <Form.Item label="Tiêu đề" name="title" rules={[{ required: true, message: 'Vui lòng nhập tiêu đề' }]}>
            <Input placeholder="Nhập tiêu đề yêu cầu" />
          </Form.Item>

          <Form.Item label="Mô tả" name="description" rules={[{ required: true, message: 'Vui lòng nhập mô tả' }]}>
            <Input.TextArea rows={3} placeholder="Nhập nội dung tổng quan" />
          </Form.Item>

          <Form.Item label="Ưu tiên" name="priority" rules={[{ required: true, message: 'Vui lòng chọn mức ưu tiên' }]}>
            <Select options={PRIORITY_OPTIONS} />
          </Form.Item>

          <Form.Item
            label="Hạn xử lý"
            name="deadline"
            rules={[
              {
                validator: (_, value) => {
                  if (!value || value.isAfter(dayjs())) {
                    return Promise.resolve();
                  }
                  return Promise.reject(new Error('Hạn xử lý phải lớn hơn thời điểm hiện tại'));
                },
              },
            ]}
          >
            <DatePicker showTime style={{ width: '100%' }} placeholder="Chọn hạn xử lý" />
          </Form.Item>

          <Form.Item label="Ghi chú" name="notes">
            <Input.TextArea rows={2} placeholder="Nhập ghi chú bổ sung (nếu có)" />
          </Form.Item>

          {editFormSchema.length > 0 && (
            <div>
              <Text strong>Thông tin theo mẫu</Text>
              <div style={{ height: 8 }} />
              {editFormSchema.map((field) => (
                <Form.Item key={field.key} label={field.label} name={['form_data', field.key]}>
                  {field.input === 'number' && <InputNumber min={0} style={{ width: '100%' }} placeholder="Nhập số" />}
                  {field.input === 'date' && <DatePicker showTime style={{ width: '100%' }} placeholder="Chọn ngày giờ" />}
                  {field.input === 'textarea' && <Input.TextArea rows={3} placeholder={`Nhập ${field.label.toLowerCase()}`} />}
                  {field.input === 'text' && <Input placeholder={`Nhập ${field.label.toLowerCase()}`} />}
                </Form.Item>
              ))}
            </div>
          )}
        </Form>
      </Modal>

      <ApprovalCreateModal
        open={createModalOpen}
        submitting={createSubmitting}
        onSubmit={handleCreateApproval}
        onCancel={() => setCreateModalOpen(false)}
      />
    </div>
  );
}
