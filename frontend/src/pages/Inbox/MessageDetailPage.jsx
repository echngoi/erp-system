import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Divider,
  Form,
  List,
  Modal,
  Select,
  Space,
  Spin,
  Input,
  Upload,
  Typography,
  message,
} from 'antd';
import {
  FileExcelOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FileUnknownOutlined,
  FileWordOutlined,
  UploadOutlined,
  FileZipOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { useNavigate, useParams } from 'react-router-dom';
import api from '../../services/api';
import { getCurrentUserId } from '../../services/auth';

const { Title, Text, Paragraph } = Typography;
const SUBJECT_MAX_LENGTH = 120;
const MAX_ATTACHMENT_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'txt', 'csv', 'zip', 'rar', '7z',
  'jpg', 'jpeg', 'png', 'gif', 'webp',
]);

function normalizeList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.results)) return payload.results;
  return [];
}

function getUserRecipient(message, currentUserId) {
  if (!currentUserId || !Array.isArray(message?.recipients)) return null;
  return message.recipients.find((recipient) => recipient.user === currentUserId) || null;
}

function buildDisplayName(user) {
  if (!user) return 'Người dùng không xác định';
  const explicitFullName = String(user.full_name || '').trim();
  if (user.username && explicitFullName) return `${user.username} - ${explicitFullName}`;
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return fullName || user.username || user.email || `Người dùng #${user.id}`;
}

function flattenReplies(replies, depth = 0) {
  if (!Array.isArray(replies)) return [];

  const rows = [];
  replies.forEach((reply) => {
    rows.push({ ...reply, depth });
    rows.push(...flattenReplies(reply.replies, depth + 1));
  });
  return rows;
}

function getAttachmentFileName(fileUrl, index, explicitName) {
  if (explicitName) return explicitName;

  if (!fileUrl) return `tep-dinh-kem-${index + 1}`;

  if (fileUrl.startsWith('data:')) {
    const mimePart = fileUrl.slice(5, fileUrl.indexOf(';') > -1 ? fileUrl.indexOf(';') : fileUrl.length);
    const ext = mimePart.includes('/') ? mimePart.split('/').pop() : 'bin';
    return `tep-dinh-kem-${index + 1}.${ext || 'bin'}`;
  }

  try {
    const pathname = new URL(fileUrl).pathname;
    const rawName = pathname.split('/').filter(Boolean).pop();
    return rawName ? decodeURIComponent(rawName) : `tep-dinh-kem-${index + 1}`;
  } catch {
    return `tep-dinh-kem-${index + 1}`;
  }
}

function getFileExtension(fileName = '') {
  const name = String(fileName || '');
  const dotIndex = name.lastIndexOf('.');
  return dotIndex >= 0 ? name.slice(dotIndex + 1).toLowerCase() : '';
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function formatFileSize(sizeInBytes) {
  if (typeof sizeInBytes !== 'number' || Number.isNaN(sizeInBytes) || sizeInBytes <= 0) {
    return '';
  }

  if (sizeInBytes < 1024) return `${sizeInBytes} B`;
  if (sizeInBytes < 1024 * 1024) return `${(sizeInBytes / 1024).toFixed(1)} KB`;
  return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getAttachmentIcon(fileName, mimeType = '') {
  const ext = getFileExtension(fileName);
  const normalizedMime = String(mimeType || '').toLowerCase();

  if (ext === 'pdf' || normalizedMime.includes('pdf')) return <FilePdfOutlined style={{ color: '#cf1322' }} />;
  if (['doc', 'docx'].includes(ext) || normalizedMime.includes('word')) return <FileWordOutlined style={{ color: '#1677ff' }} />;
  if (['xls', 'xlsx', 'csv'].includes(ext) || normalizedMime.includes('excel') || normalizedMime.includes('spreadsheet')) {
    return <FileExcelOutlined style={{ color: '#389e0d' }} />;
  }
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext) || normalizedMime.startsWith('image/')) {
    return <FileImageOutlined style={{ color: '#722ed1' }} />;
  }
  if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext) || normalizedMime.includes('zip') || normalizedMime.includes('compressed')) {
    return <FileZipOutlined style={{ color: '#d46b08' }} />;
  }
  if (['txt', 'md', 'log'].includes(ext) || normalizedMime.startsWith('text/')) {
    return <FileTextOutlined style={{ color: '#595959' }} />;
  }

  return <FileUnknownOutlined style={{ color: '#8c8c8c' }} />;
}

function AttachmentList({ attachments }) {
  const files = Array.isArray(attachments) ? attachments : [];
  if (files.length === 0) {
    return <Text type="secondary">Không có tệp đính kèm</Text>;
  }

  return (
    <List
      size="small"
      dataSource={files}
      renderItem={(item, index) => {
        const fileName = getAttachmentFileName(item.file_url, index, item.file_name);
        const sizeText = formatFileSize(item.file_size);
        return (
          <List.Item>
            <Space size={8} align="center">
              {getAttachmentIcon(fileName, item.mime_type)}
              <a href={item.file_url} target="_blank" rel="noreferrer" download={fileName}>
                {fileName}
              </a>
              {sizeText ? <Text type="secondary">({sizeText})</Text> : null}
            </Space>
          </List.Item>
        );
      }}
      style={{ marginTop: 8 }}
    />
  );
}

function normalizeAttachmentPayloadRows(attachments) {
  if (!Array.isArray(attachments)) return [];

  return attachments
    .filter((item) => item && item.file_url)
    .map((item) => ({
      file_url: item.file_url,
      file_name: item.file_name || '',
      file_size: item.file_size ?? undefined,
      mime_type: item.mime_type || '',
    }));
}

export default function MessageDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const currentUserId = getCurrentUserId();
  const [replyForm] = Form.useForm();
  const [forwardForm] = Form.useForm();

  const [messageDetail, setMessageDetail] = useState(null);
  const [userMap, setUserMap] = useState({});
  const [allUsers, setAllUsers] = useState([]);
  const [allDepartments, setAllDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [replyModalOpen, setReplyModalOpen] = useState(false);
  const [forwardModalOpen, setForwardModalOpen] = useState(false);
  const [replyFileList, setReplyFileList] = useState([]);
  const [forwardFileList, setForwardFileList] = useState([]);
  const [submittingAction, setSubmittingAction] = useState(false);

  const beforeUpload = (file) => {
    const ext = getFileExtension(file.name);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      message.warning(`File ${file.name} không đúng định dạng cho phép.`);
      return Upload.LIST_IGNORE;
    }

    if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
      message.warning(`File ${file.name} vượt quá dung lượng 10MB.`);
      return Upload.LIST_IGNORE;
    }

    return false;
  };

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const response = await api.get(`/messages/${id}/`);
      const detail = response.data;
      setMessageDetail(detail);

      const replies = flattenReplies(detail.replies);
      const userIds = new Set([
        detail.sender,
        ...(detail.recipients || []).map((recipient) => recipient.user),
        ...replies.map((reply) => reply.sender),
      ]);

      const nextUserMap = {};
      try {
        const [usersRes, departmentsRes] = await Promise.allSettled([
          api.get('/users/lookup/'),
          api.get('/departments/lookup/'),
        ]);

        const users = usersRes.status === 'fulfilled' ? normalizeList(usersRes.value.data) : [];
        const departments = departmentsRes.status === 'fulfilled' ? normalizeList(departmentsRes.value.data) : [];

        setAllUsers(users);
        setAllDepartments(departments);

        users.forEach((user) => {
          if (userIds.has(user.id)) {
            nextUserMap[user.id] = user;
          }
        });
      } catch {
        setAllUsers([]);
        setAllDepartments([]);
        // Keep rendering message details even if lookup fails.
      }
      setUserMap(nextUserMap);

      const recipient = getUserRecipient(detail, currentUserId);
      if (recipient && !recipient.is_read) {
        await api.post(`/messages/${id}/mark_read/`);
        setMessageDetail((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            recipients: prev.recipients.map((item) =>
              item.user === currentUserId
                ? { ...item, is_read: true, read_at: dayjs().toISOString() }
                : item,
            ),
          };
        });
      }
    } catch {
      setError('Không thể tải chi tiết tin nhắn.');
    } finally {
      setLoading(false);
    }
  }, [id, currentUserId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const userOptions = useMemo(
    () =>
      allUsers
        .filter((user) => user.id !== currentUserId)
        .map((user) => ({
          label: user.full_name ? `${user.username} - ${user.full_name}` : user.username,
          value: user.id,
        })),
    [allUsers, currentUserId],
  );

  const departmentOptions = useMemo(
    () =>
      allDepartments.map((department) => ({
        label: department.name || `Phòng ban #${department.id}`,
        value: department.id,
      })),
    [allDepartments],
  );

  const recipientLines = useMemo(() => {
    if (!Array.isArray(messageDetail?.recipients)) return [];

    return messageDetail.recipients.map((recipient) => {
      const displayName = buildDisplayName(userMap[recipient.user]);
      if (recipient.is_read) {
        const readAt = recipient.read_at ? dayjs(recipient.read_at).format('HH:mm DD/MM/YYYY') : '-';
        return `${displayName} - Đã đọc lúc ${readAt}`;
      }
      return `${displayName} - Chưa đọc`;
    });
  }, [messageDetail, userMap]);

  const threadReplies = useMemo(() => flattenReplies(messageDetail?.replies), [messageDetail]);

  const handleReply = async () => {
    if (!messageDetail?.sender) return;

    try {
      const values = await replyForm.validateFields();
      const attachmentRows = await Promise.all(
        replyFileList
          .map((file) => file.originFileObj)
          .filter(Boolean)
          .map(async (rawFile) => ({
            file_url: await fileToDataUrl(rawFile),
            file_name: rawFile.name,
            file_size: rawFile.size,
            mime_type: rawFile.type || '',
          })),
      );

      setSubmittingAction(true);
      await api.post(`/messages/${id}/reply/`, {
        subject: values.subject?.trim() || `Phản hồi: ${messageDetail.subject || ''}`,
        content: values.content.trim(),
        targets: [{ target_type: 'USER', target_id: messageDetail.sender, type: 'TO' }],
        attachments: attachmentRows,
      });
      message.success('Đã gửi phản hồi');
      setReplyModalOpen(false);
      replyForm.resetFields();
      setReplyFileList([]);
      loadDetail();
    } catch (err) {
      if (err?.errorFields) return;
      message.error('Không thể gửi phản hồi');
    } finally {
      setSubmittingAction(false);
    }
  };

  const handleForward = async () => {
    try {
      const values = await forwardForm.validateFields();
      const userIds = (values.user_ids || []).map(Number).filter(Boolean);
      const departmentIds = (values.department_ids || []).map(Number).filter(Boolean);

      if (userIds.length + departmentIds.length === 0) {
        forwardForm.setFields([
          {
            name: 'user_ids',
            errors: ['Vui lòng chọn ít nhất một người nhận (người dùng/phòng ban).'],
          },
        ]);
        return;
      }

      const attachmentRows = await Promise.all(
        forwardFileList
          .map((file) => file.originFileObj)
          .filter(Boolean)
          .map(async (rawFile) => ({
            file_url: await fileToDataUrl(rawFile),
            file_name: rawFile.name,
            file_size: rawFile.size,
            mime_type: rawFile.type || '',
          })),
      );
      const inheritedAttachments = normalizeAttachmentPayloadRows(messageDetail?.attachments);

      setSubmittingAction(true);
      await api.post('/messages/send/', {
        subject: values.subject?.trim() || `Chuyển tiếp: ${messageDetail?.subject || ''}`,
        content: values.content.trim(),
        targets: [
          ...userIds.map((userId) => ({ target_type: 'USER', target_id: userId, type: 'TO' })),
          ...departmentIds.map((departmentId) => ({ target_type: 'DEPARTMENT', target_id: departmentId, type: 'TO' })),
        ],
        attachments: [...inheritedAttachments, ...attachmentRows],
      });
      message.success('Đã chuyển tiếp tin nhắn');
      setForwardModalOpen(false);
      forwardForm.resetFields();
      setForwardFileList([]);
    } catch (err) {
      if (err?.errorFields) return;
      message.error('Không thể chuyển tiếp tin nhắn');
    } finally {
      setSubmittingAction(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '32px 0' }}>
        <Spin />
      </div>
    );
  }

  if (error) {
    return <Alert type="error" message={error} showIcon />;
  }

  if (!messageDetail) {
    return <Alert type="warning" message="Không tìm thấy tin nhắn." showIcon />;
  }

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Button onClick={() => navigate('/inbox')}>Quay lại hộp thư</Button>

      <Space>
        <Button
          type="primary"
          onClick={() => {
            replyForm.setFieldsValue({
              subject: `Phản hồi: ${messageDetail.subject || ''}`,
              content: '',
            });
            setReplyFileList([]);
            setReplyModalOpen(true);
          }}
        >
          Phản hồi
        </Button>
        <Button
          onClick={() => {
            forwardForm.setFieldsValue({
              subject: `Chuyển tiếp: ${messageDetail.subject || ''}`,
              user_ids: [],
              department_ids: [],
              content: `\n\n----- Tin nhắn gốc -----\n${messageDetail.content || ''}`,
            });
            setForwardFileList([]);
            setForwardModalOpen(true);
          }}
        >
          Chuyển tiếp
        </Button>
      </Space>

      <Card>
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Title level={4} style={{ margin: 0 }}>
            {messageDetail.subject || '(Không có tiêu đề)'}
          </Title>

          <Text>
            <strong>Người gửi:</strong> {buildDisplayName(userMap[messageDetail.sender])}
          </Text>

          <Text>
            <strong>Thời gian:</strong>{' '}
            {messageDetail.created_at
              ? dayjs(messageDetail.created_at).format('DD/MM/YYYY HH:mm')
              : '-'}
          </Text>

          <div>
            <Text strong>Người nhận:</Text>
            <List
              size="small"
              dataSource={recipientLines}
              locale={{ emptyText: 'Không có người nhận' }}
              renderItem={(line) => <List.Item>{line}</List.Item>}
              style={{ marginTop: 8 }}
            />
          </div>

          <Divider style={{ margin: '8px 0' }} />

          <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
            {messageDetail.content || '(Không có nội dung)'}
          </Paragraph>

          <div>
            <Text strong>Tệp đính kèm:</Text>
            <AttachmentList attachments={messageDetail.attachments} />
          </div>
        </Space>
      </Card>

      <Card>
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Title level={5} style={{ margin: 0 }}>
            Chuỗi phản hồi
          </Title>

          {threadReplies.length === 0 ? (
            <Text type="secondary">Chưa có phản hồi nào.</Text>
          ) : (
            threadReplies.map((reply, index) => (
              <div key={reply.id}>
                {index > 0 && <Divider style={{ margin: '10px 0' }} />}
                <Card
                  size="small"
                  style={{ marginLeft: `${reply.depth * 16}px` }}
                  title={reply.subject || '(Không có tiêu đề)'}
                >
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    <Text>
                      <strong>Người gửi:</strong> {buildDisplayName(userMap[reply.sender])}
                    </Text>
                    <Text>
                      <strong>Thời gian:</strong>{' '}
                      {reply.created_at ? dayjs(reply.created_at).format('DD/MM/YYYY HH:mm') : '-'}
                    </Text>
                    <Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
                      {reply.content || '(Không có nội dung)'}
                    </Paragraph>
                    <div>
                      <Text strong>Tệp đính kèm:</Text>
                      <AttachmentList attachments={reply.attachments} />
                    </div>
                  </Space>
                </Card>
              </div>
            ))
          )}
        </Space>
      </Card>

      <Modal
        open={replyModalOpen}
        title="Phản hồi tin nhắn"
        okText="Gửi phản hồi"
        cancelText="Hủy"
        confirmLoading={submittingAction}
        onCancel={() => setReplyModalOpen(false)}
        onOk={handleReply}
        destroyOnHidden
      >
        <Form form={replyForm} layout="vertical">
          <Form.Item
            label="Tiêu đề"
            name="subject"
            rules={[
              { required: true, message: 'Vui lòng nhập tiêu đề' },
              { max: SUBJECT_MAX_LENGTH, message: `Tiêu đề tối đa ${SUBJECT_MAX_LENGTH} ký tự` },
            ]}
          >
            <Input maxLength={SUBJECT_MAX_LENGTH} showCount />
          </Form.Item>
          <Form.Item
            label="Nội dung"
            name="content"
            rules={[
              { required: true, message: 'Vui lòng nhập nội dung phản hồi' },
              { min: 3, message: 'Nội dung tối thiểu 3 ký tự' },
            ]}
          >
            <Input.TextArea rows={5} maxLength={5000} showCount />
          </Form.Item>

          <Form.Item label="Đính kèm tệp">
            <Upload
              multiple
              beforeUpload={beforeUpload}
              fileList={replyFileList}
              onChange={({ fileList }) => setReplyFileList(fileList)}
            >
              <Button icon={<UploadOutlined />}>Chọn file</Button>
            </Upload>
            <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
              Chỉ hỗ trợ: PDF, Office, ảnh, TXT/CSV, ZIP/RAR/7Z. Tối đa 10MB mỗi file.
            </Text>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={forwardModalOpen}
        title="Chuyển tiếp tin nhắn"
        okText="Chuyển tiếp"
        cancelText="Hủy"
        confirmLoading={submittingAction}
        onCancel={() => setForwardModalOpen(false)}
        onOk={handleForward}
        destroyOnHidden
      >
        <Form form={forwardForm} layout="vertical">
          <Form.Item label="Chọn người nhận" name="user_ids">
            <Select mode="multiple" allowClear options={userOptions} placeholder="Chọn người dùng nhận chuyển tiếp" />
          </Form.Item>
          <Form.Item label="Chọn phòng ban nhận" name="department_ids">
            <Select mode="multiple" allowClear options={departmentOptions} placeholder="Chọn phòng ban nhận chuyển tiếp" />
          </Form.Item>

          <Form.Item
            label="Tiêu đề"
            name="subject"
            rules={[
              { required: true, message: 'Vui lòng nhập tiêu đề' },
              { max: SUBJECT_MAX_LENGTH, message: `Tiêu đề tối đa ${SUBJECT_MAX_LENGTH} ký tự` },
            ]}
          >
            <Input maxLength={SUBJECT_MAX_LENGTH} showCount />
          </Form.Item>
          <Form.Item
            label="Nội dung"
            name="content"
            rules={[
              { required: true, message: 'Vui lòng nhập nội dung chuyển tiếp' },
              { min: 3, message: 'Nội dung tối thiểu 3 ký tự' },
            ]}
          >
            <Input.TextArea rows={7} maxLength={5000} showCount />
          </Form.Item>

          {Array.isArray(messageDetail?.attachments) && messageDetail.attachments.length > 0 && (
            <Form.Item label="Tệp gốc sẽ được chuyển tiếp tự động">
              <AttachmentList attachments={messageDetail.attachments} />
            </Form.Item>
          )}

          <Form.Item label="Đính kèm tệp">
            <Upload
              multiple
              beforeUpload={beforeUpload}
              fileList={forwardFileList}
              onChange={({ fileList }) => setForwardFileList(fileList)}
            >
              <Button icon={<UploadOutlined />}>Chọn file</Button>
            </Upload>
            <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
              Chỉ hỗ trợ: PDF, Office, ảnh, TXT/CSV, ZIP/RAR/7Z. Tối đa 10MB mỗi file.
            </Text>
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
