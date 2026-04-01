import { useEffect, useMemo, useState } from 'react';
import {
  Card,
  Col,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Typography,
  Upload,
} from 'antd';
import { InboxOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import api from '../../services/api';
import { getCurrentUserId } from '../../services/auth';

const { Title } = Typography;
const { Dragger } = Upload;

const REQUEST_TYPE_OPTIONS = [
  { label: 'Task', value: 'TASK' },
  { label: 'Approval', value: 'APPROVAL' },
];

const PRIORITY_OPTIONS = [
  { label: 'Thấp', value: 'LOW' },
  { label: 'Trung bình', value: 'MEDIUM' },
  { label: 'Cao', value: 'HIGH' },
];

const TARGET_TYPE_OPTIONS = [
  { label: 'Người nhận', value: 'USER' },
  { label: 'Phòng ban nhận', value: 'DEPARTMENT' },
];

export default function CreateRequestModal({
  open,
  submitting,
  mode = 'create',
  initialValues = null,
  lockedType,
  typeOptions = REQUEST_TYPE_OPTIONS,
  onCreate,
  onSubmit,
  onCancel,
}) {
  const [form] = Form.useForm();
  const currentUserId = getCurrentUserId();
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingDepartments, setLoadingDepartments] = useState(false);
  const [fileList, setFileList] = useState([]);

  useEffect(() => {
    if (!open) return;

    const loadTargets = async () => {
      setLoadingUsers(true);
      setLoadingDepartments(true);

      try {
        const [usersResponse, departmentsResponse] = await Promise.all([
          api.get('/users/lookup/'),
          api.get('/departments/lookup/'),
        ]);

        const userList = Array.isArray(usersResponse.data)
          ? usersResponse.data
          : usersResponse.data?.results || [];
        const departmentList = Array.isArray(departmentsResponse.data)
          ? departmentsResponse.data
          : departmentsResponse.data?.results || [];

        setUsers(userList);
        setDepartments(departmentList);
      } finally {
        setLoadingUsers(false);
        setLoadingDepartments(false);
      }
    };

    loadTargets();
  }, [open]);

  useEffect(() => {
    if (!open) return;

    if (mode === 'edit' && initialValues) {
      const isUserTarget = (initialValues.target_type || 'USER') === 'USER';
      form.setFieldsValue({
        title: initialValues.title || '',
        description: initialValues.description || '',
        type: lockedType || initialValues.type || 'TASK',
        target_type: initialValues.target_type || 'USER',
        target_id: isUserTarget ? [initialValues.target_id] : initialValues.target_id,
        workflow: initialValues.workflow || undefined,
        priority: initialValues.priority || undefined,
        deadline: initialValues.deadline ? dayjs(initialValues.deadline) : null,
      });
      return;
    }

    form.setFieldsValue({
      title: '',
      description: '',
      type: lockedType || 'TASK',
      target_type: 'USER',
      target_id: undefined,
      workflow: undefined,
      priority: undefined,
      deadline: null,
    });
    setFileList([]);
  }, [open, mode, initialValues, form, lockedType]);

  const userOptions = useMemo(
    () =>
      users
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
    () =>
      departments.map((department) => ({
        value: department.id,
        label: department.name || `Department #${department.id}`,
      })),
    [departments],
  );

  const targetType = Form.useWatch('target_type', form);

  const targetOptions = targetType === 'DEPARTMENT' ? departmentOptions : userOptions;
  const targetLoading = targetType === 'DEPARTMENT' ? loadingDepartments : loadingUsers;

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      const submit = onSubmit || onCreate;
      const files = fileList.map((item) => item.originFileObj).filter(Boolean);
      await submit({ ...values, _files: files });
      form.resetFields();
      setFileList([]);
    } catch (err) {
      if (!err?.errorFields) throw err;
    }
  };

  const handleCancel = () => {
    form.resetFields();
    setFileList([]);
    onCancel();
  };

  const uploadProps = {
    multiple: true,
    fileList,
    beforeUpload: () => false,
    onChange: ({ fileList: nextList }) => setFileList(nextList),
    onRemove: (file) => setFileList((prev) => prev.filter((f) => f.uid !== file.uid)),
  };

  return (
    <Modal
      title={null}
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      okText={mode === 'edit' ? 'Lưu' : 'Tạo'}
      cancelText="Hủy"
      confirmLoading={submitting}
      destroyOnClose
      width={860}
      className="erp-form-modal"
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
        {lockedType ? (
          <Form.Item name="type" hidden>
            <Input />
          </Form.Item>
        ) : null}

        <Row gutter={[16, 16]}>
          <Col xs={24} lg={14}>
            <Card className="erp-form-modal__section" bordered={false}>
              <div className="erp-form-modal__section-header">
                <Title level={5}>Nội dung yêu cầu</Title>
              </div>

              <Form.Item
                label="Tiêu đề"
                name="title"
                rules={[{ required: true, message: 'Vui lòng nhập tiêu đề' }]}
              >
                <Input placeholder="Ví dụ: Yêu cầu cấp bổ sung ngân sách dự án" />
              </Form.Item>

              <Form.Item label="Mô tả" name="description">
                <Input.TextArea
                  rows={4}
                  placeholder="Mô tả ngắn gọn bối cảnh, nhu cầu và kết quả mong muốn (không bắt buộc)"
                />
              </Form.Item>

              <Form.Item label="Tệp đính kèm">
                <Dragger {...uploadProps} style={{ borderRadius: 8 }}>
                  <p className="ant-upload-drag-icon">
                    <InboxOutlined />
                  </p>
                  <p className="ant-upload-text">Kéo thả tệp vào đây hoặc nhấn để chọn</p>
                  <p className="ant-upload-hint">
                    Hỗ trợ nhiều tệp. Tệp sẽ được đính kèm sau khi tạo yêu cầu.
                  </p>
                </Dragger>
              </Form.Item>
            </Card>
          </Col>

          <Col xs={24} lg={10}>
            <Card className="erp-form-modal__section" bordered={false}>
              <div className="erp-form-modal__section-header">
                <Title level={5}>Cấu hình gửi</Title>
              </div>

              {!lockedType ? (
                <Form.Item label="Loại" name="type" rules={[{ required: true }]}>
                  <Select options={typeOptions} placeholder="Chọn loại yêu cầu" />
                </Form.Item>
              ) : null}

              <Form.Item
                label="Đối tượng"
                name="target_type"
                rules={[{ required: true, message: 'Vui lòng chọn đối tượng' }]}
              >
                <Select options={TARGET_TYPE_OPTIONS} placeholder="Chọn kiểu người nhận" />
              </Form.Item>

              <Form.Item
                label={targetType === 'DEPARTMENT' ? 'Chọn phòng ban nhận' : 'Chọn người nhận'}
                name="target_id"
                rules={[{ required: true, message: 'Vui lòng chọn đối tượng' }]}
              >
                <Select
                  mode={targetType === 'USER' ? 'multiple' : undefined}
                  showSearch
                  maxTagCount="responsive"
                  optionFilterProp="label"
                  placeholder={
                    targetType === 'DEPARTMENT' ? 'Chọn phòng ban nhận' : 'Chọn người nhận'
                  }
                  options={targetOptions}
                  loading={targetLoading}
                />
              </Form.Item>

              <Form.Item noStyle shouldUpdate={(prev, curr) => prev.type !== curr.type}>
                {({ getFieldValue }) => {
                  if (getFieldValue('type') !== 'APPROVAL') return null;

                  return (
                    <Form.Item
                      label="Workflow ID"
                      name="workflow"
                      rules={[
                        {
                          required: true,
                          message: 'Vui lòng nhập workflow ID cho yêu cầu APPROVAL',
                        },
                      ]}
                    >
                      <InputNumber min={1} style={{ width: '100%' }} placeholder="Ví dụ: 1" />
                    </Form.Item>
                  );
                }}
              </Form.Item>
            </Card>
          </Col>
        </Row>

        <Row gutter={[16, 16]}>
          <Col xs={24}>
            <Card
              className="erp-form-modal__section erp-form-modal__section--soft"
              bordered={false}
            >
              <div className="erp-form-modal__section-header">
                <Title level={5}>Tiến độ xử lý</Title>
              </div>

              <Row gutter={[16, 0]}>
                <Col xs={24} md={12}>
                  <Form.Item label="Ưu tiên" name="priority">
                    <Select
                      allowClear
                      options={PRIORITY_OPTIONS}
                      placeholder="Chọn mức ưu tiên (không bắt buộc)"
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item
                    label="Deadline"
                    name="deadline"
                    rules={[
                      {
                        validator: (_, value) => {
                          if (!value || value.isAfter(dayjs())) {
                            return Promise.resolve();
                          }
                          return Promise.reject(
                            new Error('Deadline phải lớn hơn thời điểm hiện tại'),
                          );
                        },
                      },
                    ]}
                  >
                    <DatePicker
                      showTime
                      style={{ width: '100%' }}
                      placeholder="Chọn deadline (không bắt buộc)"
                    />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}
