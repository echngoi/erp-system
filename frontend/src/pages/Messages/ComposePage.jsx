import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Form,
  Input,
  Row,
  Select,
  Space,
  Typography,
  Upload,
  message,
} from 'antd';
import { SendOutlined, UploadOutlined } from '@ant-design/icons';
import { CloseCircleFilled, FileExcelOutlined, FileImageOutlined, FilePdfOutlined, FileTextOutlined, FileUnknownOutlined, FileWordOutlined, FileZipOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';

const { Title, Text } = Typography;
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

function toPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getFileExtension(fileName) {
  const lastDot = String(fileName || '').lastIndexOf('.');
  if (lastDot < 0) return '';
  return fileName.slice(lastDot + 1).toLowerCase();
}

function getAttachmentIconByExtension(fileName) {
  const ext = getFileExtension(fileName);
  if (ext === 'pdf') return <FilePdfOutlined className="compose-attachment-icon compose-attachment-icon--pdf" />;
  if (['doc', 'docx'].includes(ext)) return <FileWordOutlined className="compose-attachment-icon compose-attachment-icon--word" />;
  if (['xls', 'xlsx', 'csv'].includes(ext)) return <FileExcelOutlined className="compose-attachment-icon compose-attachment-icon--excel" />;
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return <FileImageOutlined className="compose-attachment-icon compose-attachment-icon--image" />;
  if (['zip', 'rar', '7z'].includes(ext)) return <FileZipOutlined className="compose-attachment-icon compose-attachment-icon--archive" />;
  if (ext === 'txt') return <FileTextOutlined className="compose-attachment-icon compose-attachment-icon--text" />;
  return <FileUnknownOutlined className="compose-attachment-icon compose-attachment-icon--unknown" />;
}

function formatFileSize(sizeInBytes) {
  const size = Number(sizeInBytes || 0);
  if (!Number.isFinite(size) || size <= 0) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ComposeMessagePage() {
  const navigate = useNavigate();
  const [form] = Form.useForm();

  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loadingTargets, setLoadingTargets] = useState(false);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [error, setError] = useState('');
  const [fileList, setFileList] = useState([]);

  const removeAttachment = (uid) => {
    setFileList((prev) => prev.filter((item) => item.uid !== uid));
  };

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

  useEffect(() => {
    const loadTargets = async () => {
      setLoadingTargets(true);
      setError('');

      try {
        const [usersRes, departmentsRes] = await Promise.allSettled([
          api.get('/users/lookup/'),
          api.get('/departments/lookup/'),
        ]);

        if (usersRes.status === 'fulfilled') {
          setUsers(normalizeList(usersRes.value.data));
        }
        if (departmentsRes.status === 'fulfilled') {
          setDepartments(normalizeList(departmentsRes.value.data));
        }
      } catch {
        setError('Không thể tải danh sách người nhận. Vui lòng thử lại.');
      } finally {
        setLoadingTargets(false);
      }
    };

    loadTargets();
  }, []);

  const userOptions = useMemo(
    () =>
      users.map((item) => ({
        label: item.username
          ? `${item.username}${item.full_name ? ` - ${item.full_name}` : ''}`
          : item.email || `Người dùng #${item.id}`,
        value: item.id,
      })),
    [users],
  );

  const departmentOptions = useMemo(
    () =>
      departments.map((item) => ({
        label: item.name || `Phòng ban #${item.id}`,
        value: item.id,
      })),
    [departments],
  );

  const handleSubmit = async (values) => {
    const userIds = (values.user_ids || []).map(toPositiveInt).filter(Boolean);
    const departmentIds = (values.department_ids || []).map(toPositiveInt).filter(Boolean);

    if (userIds.length + departmentIds.length === 0) {
      form.setFields([
        {
          name: 'user_ids',
          errors: ['Vui lòng chọn ít nhất một người nhận (người dùng/phòng ban).'],
        },
      ]);
      return;
    }

    setSubmitLoading(true);
    try {
      const attachmentRows = await Promise.all(
        fileList
          .map((file) => file.originFileObj)
          .filter(Boolean)
          .map(async (rawFile) => ({
            file_url: await fileToDataUrl(rawFile),
            file_name: rawFile.name,
            file_size: rawFile.size,
            mime_type: rawFile.type || '',
          })),
      );

      const payload = {
        subject: values.subject.trim(),
        content: values.content.trim(),
        targets: [
          ...userIds.map((id) => ({ target_type: 'USER', target_id: id, type: 'TO' })),
          ...departmentIds.map((id) => ({ target_type: 'DEPARTMENT', target_id: id, type: 'TO' })),
        ],
        attachments: attachmentRows,
      };

      await api.post('/messages/send/', payload);
      message.success('Đã gửi tin nhắn thành công');
      form.resetFields();
      setFileList([]);
      navigate('/inbox');
    } catch {
      message.error('Gửi tin nhắn thất bại');
    } finally {
      setSubmitLoading(false);
    }
  };

  return (
    <div className="compose-message-page">
      <Card className="compose-hero-card" bordered={false}>
        <Space direction="vertical" size={2}>
          <Title level={4} style={{ margin: 0 }}>Soạn tin nhắn</Title>
          <Text type="secondary">Gửi tin nhắn nội bộ nhanh chóng đến người dùng hoặc phòng ban</Text>
        </Space>
      </Card>

      {error && <Alert type="warning" message={error} showIcon style={{ marginTop: 12 }} />}

      <Form form={form} layout="vertical" onFinish={handleSubmit}>
        <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
          <Col xs={24} lg={16}>
            <Card className="compose-card compose-main-card" bordered={false}>
              <Form.Item
                label="Tiêu đề"
                name="subject"
                rules={[
                  { required: true, message: 'Vui lòng nhập tiêu đề' },
                  { min: 3, message: 'Tiêu đề tối thiểu 3 ký tự' },
                  { max: SUBJECT_MAX_LENGTH, message: `Tiêu đề tối đa ${SUBJECT_MAX_LENGTH} ký tự` },
                ]}
              >
                <Input placeholder="Nhập tiêu đề tin nhắn" maxLength={SUBJECT_MAX_LENGTH} showCount />
              </Form.Item>

              <Form.Item
                label="Nội dung"
                name="content"
                rules={[
                  { required: true, message: 'Vui lòng nhập nội dung' },
                  { min: 5, message: 'Nội dung tối thiểu 5 ký tự' },
                ]}
              >
                <Input.TextArea rows={10} placeholder="Nhập nội dung tin nhắn" showCount maxLength={5000} />
              </Form.Item>

              <Divider style={{ margin: '12px 0 14px' }} />

              <Form.Item label="Đính kèm tệp">
                <Upload
                  multiple
                  beforeUpload={beforeUpload}
                  showUploadList={false}
                  fileList={fileList}
                  onChange={({ fileList: nextFileList }) => setFileList(nextFileList)}
                >
                  <Button icon={<UploadOutlined />}>Chọn file</Button>
                </Upload>
                {fileList.length > 0 && (
                  <div className="compose-attachment-list">
                    {fileList.map((file) => (
                      <div key={file.uid} className="compose-attachment-chip">
                        {getAttachmentIconByExtension(file.name)}
                        <div className="compose-attachment-chip__meta">
                          <Text className="compose-attachment-chip__name" ellipsis title={file.name || 'tep-dinh-kem'}>
                            {file.name || 'tep-dinh-kem'}
                          </Text>
                          {!!file.size && (
                            <Text type="secondary" className="compose-attachment-chip__size">
                              {formatFileSize(file.size)}
                            </Text>
                          )}
                        </div>
                        <Button
                          type="text"
                          className="compose-attachment-chip__remove"
                          icon={<CloseCircleFilled />}
                          onClick={() => removeAttachment(file.uid)}
                        />
                      </div>
                    ))}
                  </div>
                )}
                <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
                  Hỗ trợ: PDF, Office, ảnh, TXT/CSV, ZIP/RAR/7Z. Tối đa 10MB mỗi file.
                </Text>
              </Form.Item>
            </Card>
          </Col>

          <Col xs={24} lg={8}>
            <Space direction="vertical" size={16} style={{ width: '100%' }}>
              <Card className="compose-card compose-side-card" bordered={false}>
                <Text strong style={{ fontSize: 15 }}>Người nhận</Text>
                <div style={{ height: 12 }} />

                <Form.Item label="Người dùng" name="user_ids">
                  <Select
                    mode="multiple"
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    options={userOptions}
                    loading={loadingTargets}
                    placeholder="Chọn người nhận"
                  />
                </Form.Item>

                <Form.Item label="Phòng ban" name="department_ids" style={{ marginBottom: 0 }}>
                  <Select
                    mode="multiple"
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    options={departmentOptions}
                    loading={loadingTargets}
                    placeholder="Chọn phòng ban nhận"
                  />
                </Form.Item>
              </Card>

              <Card className="compose-card compose-side-card compose-tip-card" bordered={false}>
                <Text strong>Lưu ý gửi tin</Text>
                <Text type="secondary" style={{ display: 'block', marginTop: 6 }}>
                  Hãy chọn ít nhất một người nhận hoặc một phòng ban trước khi gửi.
                </Text>
              </Card>
            </Space>
          </Col>
        </Row>

        <Card className="compose-action-card" bordered={false} style={{ marginTop: 14 }}>
          <Space>
            <Button onClick={() => navigate('/inbox')}>Hủy</Button>
            <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={submitLoading}>
              Gửi tin nhắn
            </Button>
          </Space>
        </Card>
      </Form>
    </div>
  );
}
