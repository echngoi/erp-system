import { useEffect } from 'react';
import { Form, Input, Modal, Select } from 'antd';

export default function DepartmentFormModal({
  open,
  mode,
  managers,
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
      manager: initialValues?.manager ?? undefined,
    });
  }, [form, initialValues, open]);

  const handleOk = async () => {
    const values = await form.validateFields();
    onSubmit({
      name: values.name.trim(),
      description: values.description?.trim() || '',
      manager: values.manager ?? null,
    });
  };

  return (
    <Modal
      open={open}
      title={isEditMode ? 'Sửa phòng ban' : 'Tạo phòng ban'}
      okText={isEditMode ? 'Lưu' : 'Tạo'}
      cancelText="Hủy"
      confirmLoading={submitting}
      onCancel={onCancel}
      onOk={handleOk}
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label="Tên phòng ban"
          name="name"
          rules={[
            { required: true, message: 'Tên phòng ban là bắt buộc.' },
            { max: 255, message: 'Tên phòng ban không vượt quá 255 ký tự.' },
          ]}
        >
          <Input placeholder="Nhập tên phòng ban" />
        </Form.Item>

        <Form.Item
          label="Mô tả"
          name="description"
          rules={[
            { max: 1000, message: 'Mô tả không vượt quá 1000 ký tự.' },
          ]}
        >
          <Input.TextArea rows={4} placeholder="Nhập mô tả" />
        </Form.Item>

        <Form.Item label="Quản lý" name="manager">
          <Select allowClear options={managers} placeholder="Chọn quản lý" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
