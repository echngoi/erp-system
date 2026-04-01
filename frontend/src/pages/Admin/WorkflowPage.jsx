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

const TYPE_OPTIONS = [
  { label: 'Tất cả loại', value: 'ALL' },
  { label: 'Nghỉ phép', value: 'LEAVE' },
  { label: 'Mua hàng', value: 'PURCHASE' },
  { label: 'Công việc', value: 'TASK' },
];

const WORKFLOW_TYPE_OPTIONS = TYPE_OPTIONS.filter((item) => item.value !== 'ALL');
const DEFAULT_ROLE_LABELS = {
  admin: 'Quản trị viên',
  manager: 'Quản lý',
  staff: 'Nhân viên',
};

const TYPE_LABELS = {
  LEAVE: 'Nghỉ phép',
  PURCHASE: 'Mua hàng',
  TASK: 'Công việc',
};

const APPROVER_SCOPE_OPTIONS = [
  { label: 'Tất cả có vai trò', value: 'ALL_WITH_ROLE' },
  { label: 'Quản lý phòng ban người tạo', value: 'DEPT_OF_REQUESTER' },
  { label: 'Phòng ban cụ thể', value: 'SPECIFIC_DEPT' },
  { label: 'Người dùng cụ thể', value: 'SPECIFIC_USER' },
];

function getTypeLabel(type) {
  return TYPE_LABELS[type] || type;
}

function getRoleLabel(roleName, roleDescription = '') {
  const normalized = String(roleName || '').toLowerCase();
  return DEFAULT_ROLE_LABELS[normalized] || roleDescription || roleName;
}

function createStep(role = '') {
  return {
    id: `${Date.now()}-${Math.random()}`,
    role_required: role,
    approver_scope: 'ALL_WITH_ROLE',
    approver_department: null,
    approver_user: null,
  };
}

export default function WorkflowPage() {
  const [items, setItems] = useState([]);
  const [roles, setRoles] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [users, setUsers] = useState([]);
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [steps, setSteps] = useState([createStep()]);
  const [addStepState, setAddStepState] = useState({ open: false, workflow: null });
  const [editStepsState, setEditStepsState] = useState({
    open: false,
    workflow: null,
    workflowName: '',
    steps: [],
    hasActiveInstances: false,
    loadingInstances: false,
  });

  const [createForm] = Form.useForm();
  const [addStepForm] = Form.useForm();

  const roleOptions = useMemo(
    () => roles.map((role) => ({
      label: getRoleLabel(role.name, role.description),
      value: role.name,
    })),
    [roles],
  );

  const roleLabelMap = useMemo(
    () => Object.fromEntries(roles.map((role) => [role.name, getRoleLabel(role.name, role.description)])),
    [roles],
  );

  const departmentOptions = useMemo(
    () => departments.map((dept) => ({ label: dept.name || `Dept #${dept.id}`, value: dept.id })),
    [departments],
  );

  const userOptions = useMemo(
    () => users.map((user) => ({
      value: user.id,
      label: user.username ? `${user.username}${user.full_name ? ` - ${user.full_name}` : ''}` : user.email || `#${user.id}`,
    })),
    [users],
  );

  const defaultRoleName = roleOptions[0]?.value || '';

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const params = {};
      if (typeFilter !== 'ALL') params.type = typeFilter;
      const [workflowsResponse, rolesResponse, departmentsResponse, usersResponse] = await Promise.all([
        api.get('/workflows/', { params }),
        api.get('/roles/', { params: { page_size: 9999 } }),
        api.get('/departments/', { params: { page_size: 9999 } }),
        api.get('/users/', { params: { page_size: 9999 } }),
      ]);
      setItems(normalizeList(workflowsResponse.data));
      setRoles(normalizeList(rolesResponse.data));
      setDepartments(normalizeList(departmentsResponse.data));
      setUsers(normalizeList(usersResponse.data));
    } catch {
      setError('Không thể tải danh sách quy trình.');
      setItems([]);
      setRoles([]);
      setDepartments([]);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [typeFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const sortedStepsByOrder = (steps = []) => [...steps].sort((a, b) => a.step_order - b.step_order);

  const addBuilderStep = () => {
    setSteps((prev) => [...prev, createStep(defaultRoleName)]);
  };

  const removeBuilderStep = (index) => {
    setSteps((prev) => {
      if (prev.length <= 1) return prev;
      const next = [...prev];
      next.splice(index, 1);
      return next;
    });
  };

  const changeBuilderStepRole = (index, role) => {
    setSteps((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], role_required: role };
      return next;
    });
  };

  const changeBuilderStepScope = (index, scope) => {
    setSteps((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], approver_scope: scope, approver_department: null, approver_user: null };
      return next;
    });
  };

  const changeBuilderStepDept = (index, deptId) => {
    setSteps((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], approver_department: deptId };
      return next;
    });
  };

  const changeBuilderStepUser = (index, userId) => {
    setSteps((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], approver_user: userId };
      return next;
    });
  };

  const reorderBuilderStep = (index, targetOrder) => {
    setSteps((prev) => {
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(targetOrder - 1, 0, moved);
      return next;
    });
  };

  const changeEditStepRole = (index, role) => {
    setEditStepsState((prev) => {
      const next = [...prev.steps];
      next[index] = { ...next[index], role_required: role };
      return { ...prev, steps: next };
    });
  };

  const changeEditStepScope = (index, scope) => {
    setEditStepsState((prev) => {
      const next = [...prev.steps];
      next[index] = { ...next[index], approver_scope: scope, approver_department: null, approver_user: null };
      return { ...prev, steps: next };
    });
  };

  const changeEditStepDept = (index, deptId) => {
    setEditStepsState((prev) => {
      const next = [...prev.steps];
      next[index] = { ...next[index], approver_department: deptId };
      return { ...prev, steps: next };
    });
  };

  const changeEditStepUser = (index, userId) => {
    setEditStepsState((prev) => {
      const next = [...prev.steps];
      next[index] = { ...next[index], approver_user: userId };
      return { ...prev, steps: next };
    });
  };

  const reorderEditStep = (index, targetOrder) => {
    setEditStepsState((prev) => {
      const next = [...prev.steps];
      const [moved] = next.splice(index, 1);
      next.splice(targetOrder - 1, 0, moved);
      return { ...prev, steps: next };
    });
  };

  const addEditStep = () => {
    setEditStepsState((prev) => ({
      ...prev,
      steps: [...prev.steps, createStep(defaultRoleName)],
    }));
  };

  const removeEditStep = (index) => {
    setEditStepsState((prev) => {
      if (prev.steps.length <= 1) return prev;
      const next = [...prev.steps];
      next.splice(index, 1);
      return { ...prev, steps: next };
    });
  };

  const findInvalidScopeStep = (stepList) => stepList.find((step) => {
    if (step.approver_scope === 'SPECIFIC_DEPT') {
      return !step.approver_department;
    }
    if (step.approver_scope === 'SPECIFIC_USER') {
      return !step.approver_user;
    }
    return false;
  });

  const openCreateModal = () => {
    createForm.resetFields();
    createForm.setFieldsValue({ type: 'TASK' });
    setSteps([createStep(defaultRoleName)]);
    setCreateOpen(true);
  };

  const closeCreateModal = () => {
    setCreateOpen(false);
  };

  const submitCreateWorkflow = async () => {
    const values = await createForm.validateFields();
    const invalidStep = steps.some((step) => !step.role_required);
    if (invalidStep) {
      message.error('Vui lòng chọn vai trò cho tất cả các bước.');
      return;
    }
    const invalidScopeStep = findInvalidScopeStep(steps);
    if (invalidScopeStep) {
      message.error('Vui lòng cấu hình đầy đủ phạm vi duyệt cho các bước SPECIFIC_DEPT hoặc SPECIFIC_USER.');
      return;
    }

    setSubmitting(true);
    try {
      const workflowResponse = await api.post('/workflows/', {
        name: values.name.trim(),
        type: values.type,
        description: values.description?.trim() || '',
      });
      const workflowId = workflowResponse?.data?.id;

      for (let index = 0; index < steps.length; index += 1) {
        await api.post(`/workflows/${workflowId}/steps/`, {
          step_order: index + 1,
          role_required: steps[index].role_required,
          approver_scope: steps[index].approver_scope || 'ALL_WITH_ROLE',
          ...(steps[index].approver_scope === 'SPECIFIC_DEPT' ? { approver_department: steps[index].approver_department } : {}),
          ...(steps[index].approver_scope === 'SPECIFIC_USER' ? { approver_user: steps[index].approver_user } : {}),
        });
      }

      message.success('Tạo quy trình thành công.');
      closeCreateModal();
      loadData();
    } catch (submitError) {
      const detail = submitError?.response?.data?.detail;
      message.error(detail || 'Không thể tạo quy trình.');
    } finally {
      setSubmitting(false);
    }
  };

  const openAddStepModal = (workflow) => {
    const existingSteps = sortedStepsByOrder(workflow.steps || []);
    const occupiedOrders = new Set(existingSteps.map((step) => step.step_order));
    let defaultOrder = existingSteps.length + 1;
    for (let i = 1; i <= existingSteps.length + 1; i += 1) {
      if (!occupiedOrders.has(i)) {
        defaultOrder = i;
        break;
      }
    }

    addStepForm.resetFields();
    addStepForm.setFieldsValue({ role_required: defaultRoleName, step_order: defaultOrder });
    setAddStepState({ open: true, workflow });
  };

  const closeAddStepModal = () => {
    setAddStepState({ open: false, workflow: null });
  };

  const submitAddStep = async () => {
    if (!addStepState.workflow?.id) return;
    const values = await addStepForm.validateFields();

    setSubmitting(true);
    try {
      await api.post(`/workflows/${addStepState.workflow.id}/steps/`, {
        step_order: Number(values.step_order),
        role_required: values.role_required,
      });
      message.success('Thêm bước thành công.');
      closeAddStepModal();
      loadData();
    } catch (submitError) {
      const detail = submitError?.response?.data?.detail;
      message.error(detail || 'Không thể thêm bước.');
    } finally {
      setSubmitting(false);
    }
  };

  const openEditStepsModal = (workflow) => {
    const normalized = sortedStepsByOrder(workflow.steps || []).map((step) => ({
      id: step.id || createStep(defaultRoleName).id,
      role_required: step.role_required,
      approver_scope: step.approver_scope || 'ALL_WITH_ROLE',
      approver_department: step.approver_department || null,
      approver_user: step.approver_user || null,
    }));
    setEditStepsState({
      open: true,
      workflow,
      workflowName: workflow.name || '',
      steps: normalized.length > 0 ? normalized : [createStep(defaultRoleName)],
      hasActiveInstances: false,
      loadingInstances: true,
    });

    api.get(`/workflows/${workflow.id}/instances/`)
      .then((response) => {
        const instances = normalizeList(response.data);
        const hasActiveInstances = instances.some((item) => item.status === 'ACTIVE');
        setEditStepsState((prev) => ({
          ...prev,
          hasActiveInstances,
          loadingInstances: false,
        }));
      })
      .catch(() => {
        // Keep modal usable; backend will still enforce safety on save.
        setEditStepsState((prev) => ({
          ...prev,
          loadingInstances: false,
        }));
      });
  };

  const closeEditStepsModal = () => {
    setEditStepsState({
      open: false,
      workflow: null,
      workflowName: '',
      steps: [],
      hasActiveInstances: false,
      loadingInstances: false,
    });
  };

  const handleEditWorkflowName = (value) => {
    setEditStepsState((prev) => ({
      ...prev,
      workflowName: value,
    }));
  };

  const handleDeleteWorkflow = async (workflow) => {
    if (!workflow?.id) return;

    setDeletingId(workflow.id);
    try {
      await api.delete(`/workflows/${workflow.id}/`);
      message.success('Xóa quy trình thành công.');
      loadData();
    } catch (submitError) {
      const detail = submitError?.response?.data?.detail;
      message.error(detail || 'Không thể xóa quy trình.');
    } finally {
      setDeletingId(null);
    }
  };

  const submitEditSteps = async () => {
    if (!editStepsState.workflow?.id) return;
    const normalizedWorkflowName = editStepsState.workflowName.trim();
    if (!normalizedWorkflowName) {
      message.error('Vui lòng nhập tên quy trình.');
      return;
    }
    const invalid = editStepsState.steps.some((step) => !step.role_required);
    if (invalid) {
      message.error('Vui lòng chọn vai trò cho tất cả các bước.');
      return;
    }
    const invalidScopeStep = findInvalidScopeStep(editStepsState.steps);
    if (invalidScopeStep) {
      message.error('Vui lòng cấu hình đầy đủ phạm vi duyệt cho các bước SPECIFIC_DEPT hoặc SPECIFIC_USER.');
      return;
    }

    setSubmitting(true);
    try {
      const replaceResponse = await api.post(`/workflows/${editStepsState.workflow.id}/replace-steps/`, {
        name: normalizedWorkflowName,
        description: editStepsState.workflow.description || '',
        steps: editStepsState.steps.map((step, index) => ({
          step_order: index + 1,
          role_required: step.role_required,
          approver_scope: step.approver_scope || 'ALL_WITH_ROLE',
          ...(step.approver_scope === 'SPECIFIC_DEPT' ? { approver_department: step.approver_department } : {}),
          ...(step.approver_scope === 'SPECIFIC_USER' ? { approver_user: step.approver_user } : {}),
        })),
      });

      if (replaceResponse?.data?.version_created) {
        message.success(replaceResponse?.data?.detail || 'Đã tạo phiên bản workflow mới và cập nhật thành công các bước.');
      } else {
        message.success('Cập nhật tên và các bước quy trình thành công.');
      }
      closeEditStepsModal();
      loadData();
    } catch (submitError) {
      const detail = submitError?.response?.data?.detail;
      message.error(detail || 'Không thể cập nhật quy trình.');
    } finally {
      setSubmitting(false);
    }
  };

  const columns = useMemo(
    () => [
      {
        title: 'Quy trình',
        dataIndex: 'name',
        key: 'name',
        width: 280,
        render: (value, record) => (
          <Space>
            <span>{value}</span>
            {record.is_latest_version ? (
              <Tag color="green">Bản mới nhất</Tag>
            ) : (
              <Tag color="cyan">Bản lịch sử</Tag>
            )}
          </Space>
        ),
      },
      {
        title: 'Loại',
        dataIndex: 'type',
        key: 'type',
        width: 140,
        render: (value) => <Tag color="cyan">{getTypeLabel(value)}</Tag>,
      },
      {
        title: 'Mô tả',
        dataIndex: 'description',
        key: 'description',
        width: 300,
        render: (value) => value || '-',
      },
      {
        title: 'Các bước',
        dataIndex: 'steps',
        key: 'steps',
        render: (steps) => (
          <Space wrap>
            {(steps || []).length > 0
              ? sortedStepsByOrder(steps).map((step) => (
                <Tag key={step.id} color="blue">
                  Bước {step.step_order}: {roleLabelMap[step.role_required] || getRoleLabel(step.role_required)}
                </Tag>
              ))
              : '-'}
          </Space>
        ),
      },
      {
        title: 'Thao tác',
        key: 'actions',
        width: 300,
        render: (_, record) => (
          <Space>
            <Button size="small" onClick={() => openEditStepsModal(record)}>
              Chỉnh bước
            </Button>
            <Popconfirm
              title="Xóa quy trình"
              description={`Bạn có chắc muốn xóa quy trình ${record.name}?`}
              okText="Xóa"
              cancelText="Hủy"
              onConfirm={() => handleDeleteWorkflow(record)}
            >
              <Button size="small" danger loading={deletingId === record.id}>
                Xóa
              </Button>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [roleLabelMap, deletingId],
  );

  const addStepOrderOptions = useMemo(() => {
    const workflow = addStepState.workflow;
    if (!workflow) return [];
    const existingSteps = workflow.steps || [];
    const occupiedOrders = new Set(existingSteps.map((step) => step.step_order));
    const maxOrder = existingSteps.length + 1;
    const options = [];
    for (let i = 1; i <= maxOrder; i += 1) {
      if (!occupiedOrders.has(i)) {
        options.push({ label: `Bước ${i}`, value: i });
      }
    }
    return options;
  }, [addStepState.workflow]);

  return (
    <AdminSectionPage
      title="Quy trình"
      badge={`${items.length} quy trình`}
      description="Danh sách quy trình và toàn bộ bước phê duyệt, có thể lọc theo loại yêu cầu."
      extra={(
        <Space wrap>
          <Button type="primary" onClick={openCreateModal}>Tạo quy trình</Button>
          <Select value={typeFilter} options={TYPE_OPTIONS} onChange={setTypeFilter} style={{ width: 160 }} />
          <Button onClick={loadData}>Tải lại</Button>
        </Space>
      )}
    >
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 16 }} /> : null}
      <Table rowKey="id" loading={loading} columns={columns} dataSource={items} scroll={{ x: 1120 }} />

      <Modal
        open={createOpen}
        title="Tạo quy trình"
        okText="Tạo"
        cancelText="Hủy"
        confirmLoading={submitting}
        onCancel={closeCreateModal}
        onOk={submitCreateWorkflow}
        width={760}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical">
          <Form.Item
            label="Tên quy trình"
            name="name"
            rules={[
              { required: true, message: 'Tên quy trình là bắt buộc.' },
              { max: 255, message: 'Tên quy trình không vượt quá 255 ký tự.' },
            ]}
          >
            <Input placeholder="Nhập tên quy trình" />
          </Form.Item>

          <Form.Item
            label="Loại"
            name="type"
            rules={[{ required: true, message: 'Loại là bắt buộc.' }]}
          >
            <Select options={WORKFLOW_TYPE_OPTIONS} placeholder="Chọn loại quy trình" />
          </Form.Item>

          <Form.Item label="Mô tả" name="description">
            <Input.TextArea rows={3} placeholder="Nhập mô tả" />
          </Form.Item>
        </Form>

        <Card size="small" title="Trình cấu hình bước">
          <Space direction="vertical" style={{ width: '100%' }} size={10}>
            {steps.map((step, index) => (
              <Space key={step.id} direction="vertical" size={4} style={{ width: '100%', borderBottom: '1px solid #f0f0f0', paddingBottom: 8 }}>
                <Space wrap>
                  <Tag color="blue">Bước {index + 1}</Tag>
                  <Select
                    value={step.role_required}
                    options={roleOptions}
                    style={{ width: 170 }}
                    onChange={(value) => changeBuilderStepRole(index, value)}
                    placeholder="Chọn vai trò"
                  />
                  <Select
                    value={index + 1}
                    options={steps.map((_, idx) => ({ label: `Thứ tự ${idx + 1}`, value: idx + 1 }))}
                    style={{ width: 130 }}
                    onChange={(targetOrder) => reorderBuilderStep(index, targetOrder)}
                  />
                  <Button onClick={() => removeBuilderStep(index)} disabled={steps.length === 1}>
                    Xóa
                  </Button>
                </Space>
                <Space wrap style={{ paddingLeft: 4 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>Phạm vi duyệt:</Text>
                  <Select
                    value={step.approver_scope || 'ALL_WITH_ROLE'}
                    options={APPROVER_SCOPE_OPTIONS}
                    style={{ width: 220 }}
                    onChange={(value) => changeBuilderStepScope(index, value)}
                  />
                  {step.approver_scope === 'SPECIFIC_DEPT' && (
                    <Select
                      value={step.approver_department}
                      options={departmentOptions}
                      style={{ width: 180 }}
                      placeholder="Chọn phòng ban"
                      showSearch
                      optionFilterProp="label"
                      onChange={(value) => changeBuilderStepDept(index, value)}
                    />
                  )}
                  {step.approver_scope === 'SPECIFIC_USER' && (
                    <Select
                      value={step.approver_user}
                      options={userOptions}
                      style={{ width: 200 }}
                      placeholder="Chọn người duyệt"
                      showSearch
                      optionFilterProp="label"
                      onChange={(value) => changeBuilderStepUser(index, value)}
                    />
                  )}
                </Space>
              </Space>
            ))}

            <Button onClick={addBuilderStep}>Thêm bước</Button>
            <Text type="secondary">
              Sắp xếp lại bằng ô chọn thứ tự bên trên. Cách này đáp ứng yêu cầu reorder step mà không cần kéo thả.
            </Text>
          </Space>
        </Card>
      </Modal>

      <Modal
        open={addStepState.open}
        title={`Thêm bước - ${addStepState.workflow?.name || ''}`}
        okText="Thêm bước"
        cancelText="Hủy"
        confirmLoading={submitting}
        onCancel={closeAddStepModal}
        onOk={submitAddStep}
        destroyOnHidden
      >
        <Form form={addStepForm} layout="vertical">
          <Form.Item
            label="Vai trò"
            name="role_required"
            rules={[{ required: true, message: 'Vai trò là bắt buộc.' }]}
          >
            <Select options={roleOptions} placeholder="Chọn vai trò" />
          </Form.Item>

          <Form.Item
            label="Thứ tự bước"
            name="step_order"
            rules={[{ required: true, message: 'Thứ tự bước là bắt buộc.' }]}
          >
            <Select options={addStepOrderOptions} placeholder="Chọn thứ tự bước" />
          </Form.Item>
        </Form>
        <Text type="secondary">
          Bạn có thể chọn thứ tự từ các vị trí còn trống. Nếu không có chỗ trống, chỉ còn vị trí cuối cùng.
        </Text>
      </Modal>

      <Modal
        open={editStepsState.open}
        title={`Chỉnh sửa bước - ${editStepsState.workflowName || editStepsState.workflow?.name || ''}`}
        okText="Lưu các bước"
        cancelText="Hủy"
        confirmLoading={submitting}
        okButtonProps={{
          disabled: editStepsState.loadingInstances || editStepsState.hasActiveInstances,
        }}
        onCancel={closeEditStepsModal}
        onOk={submitEditSteps}
        width={760}
        destroyOnHidden
      >
        {editStepsState.loadingInstances ? (
          <Alert
            type="info"
            showIcon
            message="Đang kiểm tra các phiên quy trình đang hoạt động..."
            style={{ marginBottom: 12 }}
          />
        ) : null}

        {editStepsState.hasActiveInstances ? (
          <Alert
            type="warning"
            showIcon
            message="Quy trình này có phiên đang ACTIVE. Tạm khóa chỉnh sửa bước cho đến khi các phiên này hoàn tất."
            style={{ marginBottom: 12 }}
          />
        ) : null}

        <Form layout="vertical">
          <Form.Item
            label="Tên quy trình"
            required
            style={{ marginBottom: 12 }}
          >
            <Input
              value={editStepsState.workflowName}
              onChange={(event) => handleEditWorkflowName(event.target.value)}
              placeholder="Nhập tên quy trình"
              disabled={editStepsState.hasActiveInstances}
            />
          </Form.Item>
        </Form>

        <Card size="small" title="Trình cấu hình bước (quy trình hiện có)">
          <Space direction="vertical" style={{ width: '100%' }} size={10}>
            {editStepsState.steps.map((step, index) => (
              <Space key={step.id} direction="vertical" size={4} style={{ width: '100%', borderBottom: '1px solid #f0f0f0', paddingBottom: 8 }}>
                <Space wrap>
                  <Tag color="blue">Bước {index + 1}</Tag>
                  <Select
                    value={step.role_required}
                    options={roleOptions}
                    style={{ width: 170 }}
                    onChange={(value) => changeEditStepRole(index, value)}
                    placeholder="Chọn vai trò"
                    disabled={editStepsState.hasActiveInstances}
                  />
                  <Select
                    value={index + 1}
                    options={editStepsState.steps.map((_, idx) => ({ label: `Thứ tự ${idx + 1}`, value: idx + 1 }))}
                    style={{ width: 130 }}
                    onChange={(targetOrder) => reorderEditStep(index, targetOrder)}
                    disabled={editStepsState.hasActiveInstances}
                  />
                  <Button
                    onClick={() => removeEditStep(index)}
                    disabled={editStepsState.steps.length === 1 || editStepsState.hasActiveInstances}
                  >
                    Xóa
                  </Button>
                </Space>
                <Space wrap style={{ paddingLeft: 4 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>Phạm vi duyệt:</Text>
                  <Select
                    value={step.approver_scope || 'ALL_WITH_ROLE'}
                    options={APPROVER_SCOPE_OPTIONS}
                    style={{ width: 220 }}
                    onChange={(value) => changeEditStepScope(index, value)}
                    disabled={editStepsState.hasActiveInstances}
                  />
                  {step.approver_scope === 'SPECIFIC_DEPT' && (
                    <Select
                      value={step.approver_department}
                      options={departmentOptions}
                      style={{ width: 180 }}
                      placeholder="Chọn phòng ban"
                      showSearch
                      optionFilterProp="label"
                      onChange={(value) => changeEditStepDept(index, value)}
                      disabled={editStepsState.hasActiveInstances}
                    />
                  )}
                  {step.approver_scope === 'SPECIFIC_USER' && (
                    <Select
                      value={step.approver_user}
                      options={userOptions}
                      style={{ width: 200 }}
                      placeholder="Chọn người duyệt"
                      showSearch
                      optionFilterProp="label"
                      onChange={(value) => changeEditStepUser(index, value)}
                      disabled={editStepsState.hasActiveInstances}
                    />
                  )}
                </Space>
              </Space>
            ))}
            <Button onClick={addEditStep} disabled={editStepsState.hasActiveInstances}>Thêm bước</Button>
            <Text type="secondary">
              Khi lưu, toàn bộ các bước cũ sẽ được thay bằng danh sách bước mới theo thứ tự hiện tại.
            </Text>
          </Space>
        </Card>
      </Modal>
    </AdminSectionPage>
  );
}
