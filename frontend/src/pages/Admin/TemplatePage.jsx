import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import api from '../../services/api';
import AdminSectionPage from './AdminSectionPage';
import { normalizeList } from './utils';

const { Text } = Typography;

const TEMPLATE_TYPE_OPTIONS = [
  { label: 'Nghỉ phép', value: 'LEAVE' },
  { label: 'Mua hàng', value: 'PURCHASE' },
  { label: 'Chứng từ', value: 'DOCUMENT' },
];

const TEMPLATE_TYPE_LABELS = {
  LEAVE: 'Nghỉ phép',
  PURCHASE: 'Mua hàng',
  DOCUMENT: 'Chứng từ',
};

const INPUT_TYPE_OPTIONS = [
  { label: 'Văn bản', value: 'text' },
  { label: 'Văn bản dài', value: 'textarea' },
  { label: 'Số', value: 'number' },
  { label: 'Ngày', value: 'date' },
  { label: 'Lựa chọn', value: 'select' },
];

function normalizeWorkflows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.results)) return payload.results;
  return [];
}

function createField(name = '', label = '', input = 'text', required = false) {
  return {
    id: `${Date.now()}-${Math.random()}`,
    name: name || `field_${Date.now()}`,
    label: label || 'Trường mới',
    input: input || 'text',
    required: required || false,
    options: [],
  };
}

export default function TemplatePage() {
  const [items, setItems] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [formFields, setFormFields] = useState([createField()]);
  const [createForm] = Form.useForm();

  const workflowOptions = useMemo(
    () => workflows.map((wf) => ({
      value: wf.id,
      label: `${wf.name} (${wf.type})`,
    })),
    [workflows],
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const [templatesResponse, workflowsResponse] = await Promise.all([
        api.get('/templates/'),
        api.get('/workflows/'),
      ]);
      setItems(normalizeList(templatesResponse.data));
      setWorkflows(normalizeWorkflows(workflowsResponse.data));
    } catch {
      setError('Không thể tải danh sách mẫu hoặc quy trình.');
      setItems([]);
      setWorkflows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const addField = () => {
    setFormFields((prev) => [...prev, createField()]);
  };

  const removeField = (index) => {
    setFormFields((prev) => {
      if (prev.length <= 0) return prev;
      const next = [...prev];
      next.splice(index, 1);
      return next;
    });
  };

  const changeField = (index, key, value) => {
    setFormFields((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [key]: value };
      return next;
    });
  };

  const changeFieldOption = (fieldIndex, optionIndex, key, value) => {
    setFormFields((prev) => {
      const next = [...prev];
      const options = [...(next[fieldIndex].options || [])];
      if (!options[optionIndex]) {
        options[optionIndex] = { label: '', value: '' };
      }
      options[optionIndex] = { ...options[optionIndex], [key]: value };
      next[fieldIndex] = { ...next[fieldIndex], options };
      return next;
    });
  };

  const addFieldOption = (fieldIndex) => {
    setFormFields((prev) => {
      const next = [...prev];
      const options = [...(next[fieldIndex].options || [])];
      options.push({ label: '', value: '' });
      next[fieldIndex] = { ...next[fieldIndex], options };
      return next;
    });
  };

  const removeFieldOption = (fieldIndex, optionIndex) => {
    setFormFields((prev) => {
      const next = [...prev];
      const options = [...(next[fieldIndex].options || [])];
      options.splice(optionIndex, 1);
      next[fieldIndex] = { ...next[fieldIndex], options };
      return next;
    });
  };

  const openCreateModal = () => {
    createForm.resetFields();
    createForm.setFieldsValue({ is_active: true });
    setEditingTemplate(null);
    setFormFields([createField()]);
    setCreateOpen(true);
  };

  const openEditModal = (template) => {
    createForm.setFieldsValue({
      type: template.type,
      name: template.name,
      description: template.description,
      workflow: template.workflow,
      is_active: template.is_active,
    });
    setEditingTemplate(template);
    const normalizedFields = (template.schema && Array.isArray(template.schema)
      ? template.schema
      : [createField()]
    ).map((field) => ({
      ...field,
      id: field.id || `${Date.now()}-${Math.random()}`,
      options: Array.isArray(field.options) ? field.options : [],
    }));
    setFormFields(normalizedFields);
    setCreateOpen(true);
  };

  const closeModal = () => {
    setCreateOpen(false);
    setEditingTemplate(null);
  };

  const submitTemplate = async () => {
    const values = await createForm.validateFields();
    
    if (formFields.some((f) => !f.name || !f.label)) {
      message.error('Vui lòng điền đầy đủ tên và nhãn cho tất cả trường.');
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        type: values.type,
        name: values.name.trim(),
        description: values.description?.trim() || '',
        workflow: Number(values.workflow),
        is_active: values.is_active !== false,
        schema: formFields.map(({ id, ...field }) => field),
      };

      if (editingTemplate?.id) {
        await api.put(`/templates/${editingTemplate.id}/`, payload);
        message.success('Cập nhật mẫu thành công.');
      } else {
        await api.post('/templates/', payload);
        message.success('Tạo mẫu thành công.');
      }
      closeModal();
      loadData();
    } catch (submitError) {
      const detail = submitError?.response?.data?.detail;
      message.error(detail || 'Không thể lưu mẫu.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteTemplate = async (template) => {
    if (!template?.id) return;

    setDeletingId(template.id);
    try {
      await api.delete(`/templates/${template.id}/`);
      message.success('Xóa mẫu thành công.');
      loadData();
    } catch (submitError) {
      const detail = submitError?.response?.data?.detail;
      message.error(detail || 'Không thể xóa mẫu.');
    } finally {
      setDeletingId(null);
    }
  };

  const columns = useMemo(
    () => [
      {
        title: 'Loại',
        dataIndex: 'type',
        key: 'type',
        width: 120,
        render: (value) => <Tag color="cyan">{TEMPLATE_TYPE_LABELS[value] || value}</Tag>,
      },
      {
        title: 'Tên mẫu',
        dataIndex: 'name',
        key: 'name',
        width: 200,
      },
      {
        title: 'Mô tả',
        dataIndex: 'description',
        key: 'description',
        width: 250,
        render: (value) => value || '-',
      },
      {
        title: 'Quy trình',
        dataIndex: 'workflow_name',
        key: 'workflow_name',
        width: 150,
      },
      {
        title: 'Trạng thái',
        dataIndex: 'is_active',
        key: 'is_active',
        width: 100,
        render: (value) => (
          <Tag color={value ? 'green' : 'red'}>
            {value ? 'Kích hoạt' : 'Vô hiệu hóa'}
          </Tag>
        ),
      },
      {
        title: 'Thao tác',
        key: 'actions',
        width: 200,
        render: (_, record) => (
          <Space>
            <Button size="small" onClick={() => openEditModal(record)}>
              Sửa
            </Button>
            <Popconfirm
              title="Xóa mẫu"
              description={`Bạn có chắc muốn xóa mẫu ${record.name}?`}
              okText="Xóa"
              cancelText="Hủy"
              onConfirm={() => handleDeleteTemplate(record)}
            >
              <Button size="small" danger loading={deletingId === record.id}>
                Xóa
              </Button>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [deletingId],
  );

  return (
    <AdminSectionPage
      title="Mẫu Phê Duyệt"
      badge={`${items.length} mẫu`}
      description="Quản lý các mẫu biểu mẫu phê duyệt theo loại, mỗi mẫu map với một quy trình."
      extra={(
        <Space wrap>
          <Button type="primary" onClick={openCreateModal}>
            Tạo mẫu mới
          </Button>
          <Button onClick={loadData}>Tải lại</Button>
        </Space>
      )}
    >
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}
      <Table rowKey="id" loading={loading} columns={columns} dataSource={items} scroll={{ x: 1100 }} />

      <Modal
        open={createOpen}
        title={editingTemplate?.id ? `Sửa mẫu - ${editingTemplate.name}` : 'Tạo mẫu mới'}
        okText={editingTemplate?.id ? 'Cập nhật' : 'Tạo'}
        cancelText="Hủy"
        confirmLoading={submitting}
        onCancel={closeModal}
        onOk={submitTemplate}
        width={900}
        destroyOnClose
      >
        <Form form={createForm} layout="vertical">
          <Form.Item
            label="Loại phê duyệt"
            name="type"
            rules={[{ required: true, message: 'Loại là bắt buộc.' }]}
          >
            <Select options={TEMPLATE_TYPE_OPTIONS} placeholder="Chọn loại" />
          </Form.Item>

          <Form.Item
            label="Tên mẫu"
            name="name"
            rules={[
              { required: true, message: 'Tên mẫu là bắt buộc.' },
              { max: 255, message: 'Tên không vượt quá 255 ký tự.' },
            ]}
          >
            <Input placeholder="Ví dụ: Mua sắm văn phòng" />
          </Form.Item>

          <Form.Item label="Mô tả" name="description">
            <Input.TextArea rows={2} placeholder="Nhập mô tả mẫu" />
          </Form.Item>

          <Form.Item
            label="Quy trình"
            name="workflow"
            rules={[{ required: true, message: 'Quy trình là bắt buộc.' }]}
          >
            <Select options={workflowOptions} placeholder="Chọn quy trình" showSearch />
          </Form.Item>

          <Form.Item label="Trạng thái" name="is_active">
            <Select
              options={[
                { label: 'Kích hoạt', value: true },
                { label: 'Vô hiệu hóa', value: false },
              ]}
              placeholder="Chọn trạng thái"
            />
          </Form.Item>
        </Form>

        <Card size="small" title="Các trường trong mẫu">
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            {formFields.map((field, fieldIndex) => (
              <Card key={field.id} size="small" style={{ backgroundColor: '#fafafa' }}>
                <Space direction="vertical" style={{ width: '100%' }} size={8}>
                  <Space style={{ width: '100%' }} wrap>
                    <Input
                      placeholder="Tên trường (name)"
                      value={field.name}
                      onChange={(e) => changeField(fieldIndex, 'name', e.target.value)}
                      style={{ width: 180 }}
                    />
                    <Input
                      placeholder="Nhãn (label)"
                      value={field.label}
                      onChange={(e) => changeField(fieldIndex, 'label', e.target.value)}
                      style={{ width: 180 }}
                    />
                    <Select
                      value={field.input}
                      options={INPUT_TYPE_OPTIONS}
                      onChange={(value) => changeField(fieldIndex, 'input', value)}
                      style={{ width: 140 }}
                    />
                    <Select
                      value={field.required}
                      options={[
                        { label: 'Tùy chọn', value: false },
                        { label: 'Bắt buộc', value: true },
                      ]}
                      onChange={(value) => changeField(fieldIndex, 'required', value)}
                      style={{ width: 130 }}
                    />
                    <Button
                      onClick={() => removeField(fieldIndex)}
                      type="text"
                      danger
                    >
                      Xóa
                    </Button>
                  </Space>

                  {field.input === 'select' && (
                    <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #ddd' }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Các tùy chọn cho select:
                      </Text>
                      <Space direction="vertical" style={{ width: '100%', marginTop: 8 }} size={8}>
                        {(field.options || []).map((option, optionIndex) => (
                          <Space key={optionIndex} style={{ width: '100%' }}>
                            <Input
                              placeholder="Nhãn"
                              value={option.label || ''}
                              onChange={(e) => changeFieldOption(fieldIndex, optionIndex, 'label', e.target.value)}
                              style={{ width: 150 }}
                              size="small"
                            />
                            <Input
                              placeholder="Giá trị"
                              value={option.value || ''}
                              onChange={(e) => changeFieldOption(fieldIndex, optionIndex, 'value', e.target.value)}
                              style={{ width: 150 }}
                              size="small"
                            />
                            <Button
                              onClick={() => removeFieldOption(fieldIndex, optionIndex)}
                              type="text"
                              danger
                              size="small"
                            >
                              Xóa
                            </Button>
                          </Space>
                        ))}
                        <Button
                          onClick={() => addFieldOption(fieldIndex)}
                          size="small"
                        >
                          Thêm tùy chọn
                        </Button>
                      </Space>
                    </div>
                  )}
                </Space>
              </Card>
            ))}

            <Button onClick={addField}>Thêm trường</Button>
          </Space>
        </Card>
      </Modal>
    </AdminSectionPage>
  );
}
