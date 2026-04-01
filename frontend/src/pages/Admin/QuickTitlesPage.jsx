import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Form,
  Input,
  InputNumber,
  message,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import api from '../../services/api';
import AdminSectionPage from './AdminSectionPage';
import { normalizeList } from './utils';

const { Text } = Typography;

export default function QuickTitlesPage() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [form] = Form.useForm();

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/request-quick-titles/');
      setItems(normalizeList(response.data));
    } catch {
      setError('Không thể tải danh sách tiêu đề nhanh.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const openCreateModal = () => {
    setEditingItem(null);
    form.resetFields();
    form.setFieldsValue({ is_active: true, sort_order: 0 });
    setModalOpen(true);
  };

  const openEditModal = (item) => {
    setEditingItem(item);
    form.setFieldsValue({
      title: item.title,
      description: item.description || '',
      is_active: item.is_active,
      sort_order: item.sort_order || 0,
    });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingItem(null);
    form.resetFields();
  };

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields();
      setSubmitting(true);
      if (editingItem) {
        await api.put(`/request-quick-titles/${editingItem.id}/`, values);
        message.success('Đã cập nhật tiêu đề nhanh');
      } else {
        await api.post('/request-quick-titles/', values);
        message.success('Đã tạo tiêu đề nhanh');
      }
      closeModal();
      loadData();
    } catch (err) {
      if (err?.response?.data?.title) {
        message.error(err.response.data.title[0] || 'Tiêu đề bị trùng hoặc không hợp lệ.');
      } else if (err?.errorFields) {
        // AntD validation error - do nothing, AntD shows inline
      } else {
        message.error('Không thể lưu tiêu đề nhanh.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (item) => {
    setDeletingId(item.id);
    try {
      await api.delete(`/request-quick-titles/${item.id}/`);
      message.success('Đã xóa tiêu đề nhanh');
      loadData();
    } catch {
      message.error('Không thể xóa tiêu đề nhanh.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleToggleActive = async (item, checked) => {
    try {
      await api.patch(`/request-quick-titles/${item.id}/`, { is_active: checked });
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, is_active: checked } : i)));
    } catch {
      message.error('Không thể cập nhật trạng thái.');
    }
  };

  const columns = [
    {
      title: 'STT',
      key: 'index',
      width: 60,
      render: (_, __, index) => index + 1,
    },
    {
      title: 'Tiêu đề',
      dataIndex: 'title',
      key: 'title',
      render: (title) => <Text strong>{title}</Text>,
    },
    {
      title: 'Mô tả',
      dataIndex: 'description',
      key: 'description',
      render: (desc) => desc ? <Text type="secondary">{desc}</Text> : <Text type="secondary">-</Text>,
    },
    {
      title: 'Thứ tự',
      dataIndex: 'sort_order',
      key: 'sort_order',
      width: 100,
      sorter: (a, b) => a.sort_order - b.sort_order,
    },
    {
      title: 'Hiển thị',
      dataIndex: 'is_active',
      key: 'is_active',
      width: 100,
      render: (isActive, record) => (
        <Switch
          size="small"
          checked={isActive}
          onChange={(checked) => handleToggleActive(record, checked)}
        />
      ),
    },
    {
      title: 'Trạng thái',
      dataIndex: 'is_active',
      key: 'status_tag',
      width: 110,
      render: (isActive) => (
        <Tag color={isActive ? 'success' : 'default'}>{isActive ? 'Đang dùng' : 'Ẩn'}</Tag>
      ),
    },
    {
      title: 'Hành động',
      key: 'actions',
      width: 160,
      render: (_, record) => (
        <Space>
          <Button size="small" onClick={() => openEditModal(record)}>
            Sửa
          </Button>
          <Popconfirm
            title="Xác nhận xóa tiêu đề này?"
            onConfirm={() => handleDelete(record)}
            okText="Xóa"
            cancelText="Hủy"
          >
            <Button
              size="small"
              danger
              loading={deletingId === record.id}
            >
              Xóa
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <AdminSectionPage
      title="Tiêu đề yêu cầu nhanh"
      description="Quản lý danh sách tiêu đề gợi ý cho người dùng khi tạo yêu cầu nhanh. Người dùng có thể chọn từ danh sách này hoặc nhập tùy ý."
      badge={`${items.length} tiêu đề`}
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>
          Thêm tiêu đề
        </Button>
      }
    >
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}

      <Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={items}
        pagination={{ pageSize: 20, showSizeChanger: false }}
        size="middle"
      />

      <Modal
        title={editingItem ? 'Sửa tiêu đề nhanh' : 'Thêm tiêu đề nhanh'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={closeModal}
        okText={editingItem ? 'Lưu' : 'Thêm'}
        cancelText="Hủy"
        confirmLoading={submitting}
        destroyOnClose
        width={500}
      >
        <Form form={form} layout="vertical">
          <Form.Item
            label="Tiêu đề"
            name="title"
            rules={[{ required: true, message: 'Vui lòng nhập tiêu đề' }]}
          >
            <Input placeholder="Ví dụ: Đổ mực máy in" maxLength={255} showCount />
          </Form.Item>

          <Form.Item label="Mô tả / Gợi ý" name="description">
            <Input.TextArea
              rows={2}
              placeholder="Ghi chú thêm hiển thị cho người dùng (không bắt buộc)"
              maxLength={500}
              showCount
            />
          </Form.Item>

          <Form.Item label="Thứ tự hiển thị" name="sort_order">
            <InputNumber min={0} style={{ width: '100%' }} placeholder="0" />
          </Form.Item>

          <Form.Item label="Hiển thị cho người dùng" name="is_active" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </AdminSectionPage>
  );
}
