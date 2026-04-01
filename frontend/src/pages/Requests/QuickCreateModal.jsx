import { useEffect, useMemo, useState } from 'react';
import {
  AutoComplete,
  Col,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Typography,
} from 'antd';
import api from '../../services/api';
import { getCurrentUserId } from '../../services/auth';

const { Text } = Typography;

const TARGET_TYPE_OPTIONS = [
  { label: 'Người nhận', value: 'USER' },
  { label: 'Phòng ban nhận', value: 'DEPARTMENT' },
];

function normalizeList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.results)) return payload.results;
  return [];
}

export default function QuickCreateModal({ open, submitting, onSubmit, onCancel }) {
  const [form] = Form.useForm();
  const currentUserId = getCurrentUserId();
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingDepartments, setLoadingDepartments] = useState(false);
  const [quickTitles, setQuickTitles] = useState([]);

  useEffect(() => {
    if (!open) return;

    const loadData = async () => {
      setLoadingUsers(true);
      setLoadingDepartments(true);
      try {
        const [usersRes, depsRes, titlesRes] = await Promise.all([
          api.get('/users/lookup/'),
          api.get('/departments/lookup/'),
          api.get('/request-quick-titles/').catch(() => ({ data: [] })),
        ]);
        setUsers(normalizeList(usersRes.data));
        setDepartments(normalizeList(depsRes.data));
        setQuickTitles(normalizeList(titlesRes.data));
      } finally {
        setLoadingUsers(false);
        setLoadingDepartments(false);
      }
    };

    form.resetFields();
    form.setFieldsValue({ target_type: 'USER' });
    loadData();
  }, [open, form]);

  const userOptions = useMemo(
    () => users
      .filter((user) => user.id !== currentUserId)
      .map((user) => ({
        value: user.id,
        label: user.username
          ? `${user.username}${user.full_name ? ` - ${user.full_name}` : ''}`
          : user.email || `User #${user.id}`,
      })),
    [users, currentUserId],
  );

  const departmentOptions = useMemo(
    () => departments.map((dep) => ({
      value: dep.id,
      label: dep.name || `Department #${dep.id}`,
    })),
    [departments],
  );

  const titleSuggestions = useMemo(
    () => quickTitles.map((qt) => ({
      value: qt.title,
      label: (
        <div>
          <Text strong>{qt.title}</Text>
          {qt.description ? (
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>{qt.description}</Text>
            </div>
          ) : null}
        </div>
      ),
    })),
    [quickTitles],
  );

  const targetType = Form.useWatch('target_type', form);
  const targetOptions = targetType === 'DEPARTMENT' ? departmentOptions : userOptions;
  const targetLoading = targetType === 'DEPARTMENT' ? loadingDepartments : loadingUsers;

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      await onSubmit(values);
      form.resetFields();
    } catch {
      // Validation errors shown by AntD
    }
  };

  const handleCancel = () => {
    form.resetFields();
    onCancel();
  };

  return (
    <Modal
      title="Tạo yêu cầu nhanh"
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      okText="Tạo"
      cancelText="Hủy"
      confirmLoading={submitting}
      destroyOnClose
      width={520}
    >
      <Form
        form={form}
        layout="vertical"
        onValuesChange={(changedValues) => {
          if ('target_type' in changedValues) {
            form.setFieldValue('target_id', undefined);
          }
        }}
      >
        <Form.Item
          label="Tiêu đề yêu cầu"
          name="title"
          rules={[{ required: true, message: 'Vui lòng nhập hoặc chọn tiêu đề' }]}
        >
          <AutoComplete
            options={titleSuggestions}
            placeholder="Nhập tiêu đề hoặc chọn từ gợi ý..."
            filterOption={(inputValue, option) =>
              String(option?.value || '').toLowerCase().includes(inputValue.toLowerCase())
            }
            allowClear
          >
            <Input />
          </AutoComplete>
        </Form.Item>

        <Form.Item label="Mô tả thêm" name="description">
          <Input.TextArea rows={2} placeholder="Ghi chú thêm nếu cần (không bắt buộc)" />
        </Form.Item>

        <Row gutter={12}>
          <Col xs={24} sm={10}>
            <Form.Item
              label="Gửi đến"
              name="target_type"
              rules={[{ required: true }]}
            >
              <Select options={TARGET_TYPE_OPTIONS} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={14}>
            <Form.Item
              label={targetType === 'DEPARTMENT' ? 'Phòng ban' : 'Người nhận'}
              name="target_id"
              rules={[{ required: true, message: 'Vui lòng chọn người/phòng ban nhận' }]}
            >
              <Select
                mode={targetType === 'USER' ? 'multiple' : undefined}
                showSearch
                maxTagCount="responsive"
                optionFilterProp="label"
                placeholder={targetType === 'DEPARTMENT' ? 'Chọn phòng ban' : 'Chọn người nhận'}
                options={targetOptions}
                loading={targetLoading}
              />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}
