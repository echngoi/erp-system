import { Tag } from 'antd';

const STATUS_META = {
  CREATED: { tone: 'neutral', label: 'Mới tạo' },
  PENDING: { tone: 'warning', label: 'Chờ xử lý' },
  ACCEPTED: { tone: 'processing', label: 'Đã nhận' },
  REJECTED: { tone: 'error', label: 'Đã từ chối' },
  IN_PROGRESS: { tone: 'processing', label: 'Đang thực hiện' },
  DONE: { tone: 'success', label: 'Đã hoàn thành' },
  FAILED: { tone: 'error', label: 'Không hoàn thành' },
  RATED: { tone: 'success', label: 'Đã đánh giá' },
  PENDING_APPROVAL: { tone: 'warning', label: 'Chờ phê duyệt' },
  APPROVED: { tone: 'success', label: 'Đã phê duyệt' },
};

export default function RequestStatusTag({ status }) {
  const meta = STATUS_META[status] || { tone: 'neutral', label: status || 'Không xác định' };
  return <Tag className={`status-tag status-tag--${meta.tone}`}>{meta.label}</Tag>;
}
