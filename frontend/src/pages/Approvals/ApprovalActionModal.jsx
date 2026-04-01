import { Form, Input, Modal } from 'antd';

export default function ApprovalActionModal({
  open,
  actionType,
  actionCount = 1,
  submitting,
  onSubmit,
  onCancel,
}) {
  const [form] = Form.useForm();

  const isApprove = actionType === 'approve';
  const pluralSuffix = actionCount > 1 ? ` ${actionCount} yêu cầu` : ' yêu cầu';
  const title = isApprove ? `Duyệt${pluralSuffix}` : `Từ chối${pluralSuffix}`;
  const okText = isApprove ? `Duyệt${pluralSuffix}` : `Từ chối${pluralSuffix}`;
  const noteRules = isApprove
    ? []
    : [
      { required: true, message: 'Vui lòng nhập lý do' },
      { min: 5, message: 'Lý do cần tối thiểu 5 ký tự' },
    ];

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      await onSubmit((values.note || '').trim());
      form.resetFields();
    } catch {
      // Validation errors are rendered by Ant Design form.
    }
  };

  const handleCancel = () => {
    form.resetFields();
    onCancel();
  };

  return (
    <Modal
      title={title}
      open={open}
      onOk={handleOk}
      onCancel={handleCancel}
      okText={okText}
      cancelText="Hủy"
      confirmLoading={submitting}
      okButtonProps={{ danger: !isApprove }}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item
          label={isApprove ? 'Ghi chú (không bắt buộc)' : 'Lý do'}
          name="note"
          rules={noteRules}
        >
          <Input.TextArea
            rows={4}
            placeholder={isApprove ? 'Có thể nhập ghi chú duyệt (tuỳ chọn)' : 'Nhập lý do từ chối'}
            maxLength={500}
            showCount
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
