import { useEffect, useMemo } from 'react';
import { Checkbox, Empty, Modal, Space, Tag, Typography } from 'antd';

const { Text } = Typography;

export default function AssignPermissionsModal({
  open,
  role,
  permissions,
  selectedPermissionIds,
  submitting,
  onChange,
  onCancel,
  onSubmit,
}) {
  useEffect(() => {
    if (!open) return;
  }, [open]);

  const options = useMemo(
    () => permissions.map((permission) => ({
      label: (
        <Space size={8}>
          <Tag color="blue">{permission.code}</Tag>
          <Text>{permission.name}</Text>
        </Space>
      ),
      value: permission.id,
    })),
    [permissions],
  );

  return (
    <Modal
      open={open}
      title={`Gán quyền - ${role?.name || ''}`}
      okText="Lưu"
      cancelText="Hủy"
      confirmLoading={submitting}
      onCancel={onCancel}
      onOk={onSubmit}
      destroyOnHidden
    >
      {options.length === 0 ? (
        <Empty description="Chưa có quyền nào" />
      ) : (
        <Checkbox.Group
          style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
          options={options}
          value={selectedPermissionIds}
          onChange={onChange}
        />
      )}
    </Modal>
  );
}
