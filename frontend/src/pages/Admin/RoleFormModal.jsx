import { useEffect } from 'react';
import { Form, Input, Modal } from 'antd';

export default function RoleFormModal({
  open,
  mode = 'create',
  initialValues,
  submitting,
  onCancel,
  onSubmit,
}) {
  const [form] = Form.useForm();
  const isEditMode = mode === 'edit';

  useEffect(() => {
    if (!open) {
      form.resetFields();
      return;
    }

    form.setFieldsValue({
      name: initialValues?.name || '',
      description: initialValues?.description || '',
    });
  }, [form, initialValues, open]);

  const handleOk = async () => {
    const values = await form.validateFields();
    onSubmit({
      name: values.name.trim(),
      description: values.description?.trim() || '',
    });
  };

  return (
    <Modal
      open={open}
      title={isEditMode ? 'Sửa vai trò' : 'Tạo vai trò'}
      okText={isEditMode ? 'Lưu' : 'Tạo'}
      cancelText="Hủy"
      confirmLoading={submitting}
      onCancel={onCancel}
      onOk={handleOk}
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label="Tên vai trò"
          name="name"
          rules={[
            { required: true, message: 'Tên vai trò là bắt buộc.' },
            { min: 2, message: 'Tên vai trò phải có ít nhất 2 ký tự.' },
            { max: 100, message: 'Tên vai trò không vượt quá 100 ký tự.' },
          ]}
        >
          <Input placeholder="Nhập tên vai trò" />
        </Form.Item>

        <Form.Item
          label="Mô tả"
          name="description"
          rules={[{ max: 500, message: 'Mô tả không vượt quá 500 ký tự.' }]}
        >
          <Input.TextArea rows={4} placeholder="Nhập mô tả vai trò" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
