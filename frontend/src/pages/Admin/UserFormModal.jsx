import { useEffect } from 'react';
import { Form, Input, Modal, Select } from 'antd';
import api from '../../services/api';

export default function UserFormModal({
  open,
  mode,
  departments,
  roleOptions,
  initialValues,
  submitting,
  onCancel,
  onSubmit,
}) {
  const [form] = Form.useForm();
  const isEditMode = mode === 'edit';

  const validateUsernameAsync = async (_, value) => {
    if (!value || !value.trim()) {
      return Promise.resolve();
    }

    const trimmedUsername = value.trim();
    const params = { username: trimmedUsername };
    if (isEditMode && initialValues?.id) {
      params.exclude_id = initialValues.id;
    }

    try {
      const response = await api.get('/users/check-username/', { params });
      if (response.data.exists) {
        return Promise.reject(new Error('Tên đăng nhập đã tồn tại'));
      }
      return Promise.resolve();
    } catch (error) {
      if (error.response?.status === 403 || error.response?.status === 401) {
        return Promise.reject(new Error('Không có quyền kiểm tra tên đăng nhập'));
      }
      return Promise.reject(error);
    }
  };

  useEffect(() => {
    if (!open) {
      form.resetFields();
      return;
    }

    form.setFieldsValue({
      username: initialValues?.username || '',
      full_name: initialValues?.full_name || '',
      password: '',
      department: initialValues?.department ?? undefined,
      role_id: initialValues?.role_id,
    });
  }, [form, initialValues, open]);

  const handleOk = async () => {
    const values = await form.validateFields();
    const payload = {
      username: values.username.trim(),
      full_name: values.full_name?.trim() || '',
      department: values.department ?? null,
      role_id: values.role_id,
    };

    if (values.password) {
      payload.password = values.password;
    }

    onSubmit(payload);
  };

  return (
    <Modal
      open={open}
      title={isEditMode ? 'Sửa người dùng' : 'Tạo người dùng'}
      okText={isEditMode ? 'Lưu' : 'Tạo'}
      cancelText="Hủy"
      confirmLoading={submitting}
      onCancel={onCancel}
      onOk={handleOk}
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label="Tên đăng nhập"
          name="username"
          rules={[
            { required: true, message: 'Tên đăng nhập là bắt buộc.' },
            { min: 3, message: 'Tên đăng nhập phải có ít nhất 3 ký tự.' },
            { max: 150, message: 'Tên đăng nhập không vượt quá 150 ký tự.' },
            { validator: validateUsernameAsync },
          ]}
        >
          <Input placeholder="Nhập tên đăng nhập" />
        </Form.Item>

        <Form.Item
          label="Họ và tên"
          name="full_name"
          rules={[
            { max: 255, message: 'Họ và tên không vượt quá 255 ký tự.' },
          ]}
        >
          <Input placeholder="Nhập họ và tên" />
        </Form.Item>

        <Form.Item
          label="Mật khẩu"
          name="password"
          rules={isEditMode
            ? [
              { min: 8, message: 'Mật khẩu phải có ít nhất 8 ký tự.' },
            ]
            : [
              { required: true, message: 'Mật khẩu là bắt buộc.' },
              { min: 8, message: 'Mật khẩu phải có ít nhất 8 ký tự.' },
            ]}
          extra={isEditMode ? 'Để trống nếu không muốn thay đổi mật khẩu hiện tại.' : null}
        >
          <Input.Password placeholder={isEditMode ? 'Để trống để giữ mật khẩu hiện tại' : 'Nhập mật khẩu'} />
        </Form.Item>

        <Form.Item
          label="Vai trò"
          name="role_id"
          rules={[{ required: true, message: 'Vai trò là bắt buộc.' }]}
        >
          <Select
            allowClear
            options={roleOptions}
            placeholder="Chọn vai trò"
          />
        </Form.Item>

        <Form.Item label="Phòng ban" name="department">
          <Select
            allowClear
            options={departments}
            placeholder="Chọn phòng ban"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
