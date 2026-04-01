import { useEffect, useState } from 'react';
import {
  Card, Table, Button, Space, Tag, Typography, message, Modal, Form,
  Input, Select, TimePicker, Popconfirm, Drawer, InputNumber, Divider, Tabs, Tooltip,
} from 'antd';
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ClockCircleOutlined,
  SettingOutlined, DollarOutlined, MinusCircleOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  getShifts, createShift, updateShift, deleteShift,
  getLateEarlyRules, saveLateEarlyRules,
  getPenaltyConfigs, savePenaltyConfigs,
} from '../../services/attendanceApi';

const { Text, Title } = Typography;

const SHIFT_TYPE_LABELS = {
  hc: 'Ca HC (2 lần chấm)',
  '3punch': 'Ca 3 lần chấm',
  '4punch': 'Ca 4 lần chấm',
};
const SHIFT_TYPE_COLORS = { hc: 'blue', '3punch': 'orange', '4punch': 'purple' };
const TIME_FORMAT = 'HH:mm';

export default function ShiftManagement() {
  const [shifts, setShifts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();
  const [shiftType, setShiftType] = useState('hc');

  // Settings drawer
  const [settingsShift, setSettingsShift] = useState(null);
  const [lateRules, setLateRules] = useState([]);
  const [earlyRules, setEarlyRules] = useState([]);
  const [latePenalties, setLatePenalties] = useState([]);
  const [earlyPenalties, setEarlyPenalties] = useState([]);
  const [settingsLoading, setSettingsLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await getShifts();
      setShifts(res.data);
    } catch {
      message.error('Lỗi tải danh sách ca');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => {
    setEditing(null);
    setShiftType('hc');
    form.resetFields();
    form.setFieldsValue({ shift_type: 'hc' });
    setModal(true);
  };

  const openEdit = (record) => {
    setEditing(record);
    setShiftType(record.shift_type);
    form.resetFields();
    form.setFieldsValue({
      name: record.name,
      shift_type: record.shift_type,
      start_time: record.start_time ? dayjs(record.start_time, TIME_FORMAT) : null,
      end_time: record.end_time ? dayjs(record.end_time, TIME_FORMAT) : null,
      mid_time: record.mid_time ? dayjs(record.mid_time, TIME_FORMAT) : null,
      mid_time2: record.mid_time2 ? dayjs(record.mid_time2, TIME_FORMAT) : null,
    });
    setModal(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        name: values.name,
        shift_type: values.shift_type,
        start_time: values.start_time?.format(TIME_FORMAT),
        end_time: values.end_time?.format(TIME_FORMAT),
        mid_time: values.mid_time?.format(TIME_FORMAT) || null,
        mid_time2: values.mid_time2?.format(TIME_FORMAT) || null,
      };

      if (editing) {
        await updateShift(editing.id, payload);
        message.success('Đã cập nhật ca');
      } else {
        await createShift(payload);
        message.success('Đã tạo ca mới');
      }
      setModal(false);
      load();
    } catch (err) {
      if (err.response?.data) {
        const errors = err.response.data;
        const msgs = Object.values(errors).flat().join(', ');
        message.error(msgs);
      }
    }
  };

  const handleDelete = async (id) => {
    try {
      await deleteShift(id);
      message.success('Đã xóa ca');
      load();
    } catch {
      message.error('Lỗi xóa ca');
    }
  };

  /* ── Settings Drawer ── */
  const openSettings = async (shift) => {
    setSettingsShift(shift);
    setSettingsLoading(true);
    try {
      const [rulesRes, penaltiesRes] = await Promise.all([
        getLateEarlyRules(shift.id),
        getPenaltyConfigs(shift.id),
      ]);
      const rules = rulesRes.data || [];
      setLateRules(rules.filter(r => r.rule_type === 'late').map((r, i) => ({ ...r, key: i })));
      setEarlyRules(rules.filter(r => r.rule_type === 'early').map((r, i) => ({ ...r, key: i })));
      const pens = penaltiesRes.data || [];
      setLatePenalties(pens.filter(p => p.rule_type === 'late').map((p, i) => ({ ...p, key: i })));
      setEarlyPenalties(pens.filter(p => p.rule_type === 'early').map((p, i) => ({ ...p, key: i })));
    } catch {
      message.error('Lỗi tải cấu hình');
    } finally {
      setSettingsLoading(false);
    }
  };

  const addRule = (type) => {
    const setter = type === 'late' ? setLateRules : setEarlyRules;
    const getter = type === 'late' ? lateRules : earlyRules;
    setter([...getter, { key: Date.now(), rule_type: type, from_minutes: 0, to_minutes: null, label: '' }]);
  };

  const updateRule = (type, key, field, value) => {
    const setter = type === 'late' ? setLateRules : setEarlyRules;
    const getter = type === 'late' ? lateRules : earlyRules;
    setter(getter.map(r => r.key === key ? { ...r, [field]: value } : r));
  };

  const removeRule = (type, key) => {
    const setter = type === 'late' ? setLateRules : setEarlyRules;
    const getter = type === 'late' ? lateRules : earlyRules;
    setter(getter.filter(r => r.key !== key));
  };

  const addPenalty = (type) => {
    const setter = type === 'late' ? setLatePenalties : setEarlyPenalties;
    const getter = type === 'late' ? latePenalties : earlyPenalties;
    setter([...getter, { key: Date.now(), rule_type: type, from_count: 1, to_count: null, penalty_amount: 0 }]);
  };

  const updatePenalty = (type, key, field, value) => {
    const setter = type === 'late' ? setLatePenalties : setEarlyPenalties;
    const getter = type === 'late' ? latePenalties : earlyPenalties;
    setter(getter.map(p => p.key === key ? { ...p, [field]: value } : p));
  };

  const removePenalty = (type, key) => {
    const setter = type === 'late' ? setLatePenalties : setEarlyPenalties;
    const getter = type === 'late' ? latePenalties : earlyPenalties;
    setter(getter.filter(p => p.key !== key));
  };

  const handleSaveSettings = async () => {
    if (!settingsShift) return;
    setSettingsLoading(true);
    try {
      const allRules = [
        ...lateRules.map(r => ({ rule_type: 'late', from_minutes: r.from_minutes, to_minutes: r.to_minutes, label: r.label })),
        ...earlyRules.map(r => ({ rule_type: 'early', from_minutes: r.from_minutes, to_minutes: r.to_minutes, label: r.label })),
      ];
      const allPenalties = [
        ...latePenalties.map(p => ({ rule_type: 'late', from_count: p.from_count, to_count: p.to_count, penalty_amount: p.penalty_amount })),
        ...earlyPenalties.map(p => ({ rule_type: 'early', from_count: p.from_count, to_count: p.to_count, penalty_amount: p.penalty_amount })),
      ];
      await Promise.all([
        saveLateEarlyRules(settingsShift.id, allRules),
        savePenaltyConfigs(settingsShift.id, allPenalties),
      ]);
      message.success('Đã lưu cấu hình');
    } catch {
      message.error('Lỗi lưu cấu hình');
    } finally {
      setSettingsLoading(false);
    }
  };

  const renderRuleEditor = (type, rules) => (
    <div>
      <div style={{ marginBottom: 8, fontWeight: 600, color: type === 'late' ? '#fa8c16' : '#1890ff' }}>
        {type === 'late' ? '⏰ Mốc đi muộn (phút)' : '⏰ Mốc về sớm (phút)'}
      </div>
      {rules.map(r => (
        <Space key={r.key} style={{ marginBottom: 8, display: 'flex' }} align="center">
          <InputNumber min={0} value={r.from_minutes} onChange={v => updateRule(type, r.key, 'from_minutes', v)}
            placeholder="Từ" style={{ width: 80 }} addonBefore="Từ" />
          <InputNumber min={0} value={r.to_minutes} onChange={v => updateRule(type, r.key, 'to_minutes', v)}
            placeholder="Đến" style={{ width: 80 }} addonBefore="Đến" />
          <Input value={r.label} onChange={e => updateRule(type, r.key, 'label', e.target.value)}
            placeholder="Tên mốc (VD: Muộn 15-30p)" style={{ width: 200 }} />
          <Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => removeRule(type, r.key)} />
        </Space>
      ))}
      <Button type="dashed" icon={<PlusOutlined />} onClick={() => addRule(type)} size="small">
        Thêm mốc
      </Button>
    </div>
  );

  const renderPenaltyEditor = (type, penalties) => (
    <div>
      <div style={{ marginBottom: 8, fontWeight: 600, color: '#722ed1' }}>
        <DollarOutlined /> Phạt {type === 'late' ? 'đi muộn' : 'về sớm'} (theo số lần/tháng)
      </div>
      {penalties.map(p => (
        <Space key={p.key} style={{ marginBottom: 8, display: 'flex' }} align="center">
          <InputNumber min={1} value={p.from_count} onChange={v => updatePenalty(type, p.key, 'from_count', v)}
            placeholder="Từ lần" style={{ width: 100 }} addonBefore="Từ lần" />
          <InputNumber min={1} value={p.to_count} onChange={v => updatePenalty(type, p.key, 'to_count', v)}
            placeholder="Đến lần" style={{ width: 100 }} addonBefore="Đến lần" />
          <InputNumber min={0} step={10000} value={p.penalty_amount}
            onChange={v => updatePenalty(type, p.key, 'penalty_amount', v)}
            placeholder="Số tiền" style={{ width: 160 }}
            addonAfter="₫"
            formatter={v => v ? `${v}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : ''}
            parser={v => v.replace(/,/g, '')} />
          <Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => removePenalty(type, p.key)} />
        </Space>
      ))}
      <Button type="dashed" icon={<PlusOutlined />} onClick={() => addPenalty(type)} size="small">
        Thêm mốc phạt
      </Button>
    </div>
  );

  const columns = [
    {
      title: 'Tên ca',
      dataIndex: 'name',
      render: v => <Text strong>{v}</Text>,
    },
    {
      title: 'Loại ca',
      dataIndex: 'shift_type',
      width: 180,
      render: v => <Tag color={SHIFT_TYPE_COLORS[v]}>{SHIFT_TYPE_LABELS[v]}</Tag>,
    },
    {
      title: 'Khung giờ',
      key: 'times',
      render: (_, r) => {
        if (r.shift_type === 'hc') {
          return <Text>{r.start_time?.slice(0, 5)} → {r.end_time?.slice(0, 5)}</Text>;
        }
        if (r.shift_type === '3punch') {
          return (
            <Space size={4}>
              <Tag color="green">{r.start_time?.slice(0, 5)}</Tag>
              <Tag color="orange">{r.mid_time?.slice(0, 5)}</Tag>
              <Tag color="red">{r.end_time?.slice(0, 5)}</Tag>
            </Space>
          );
        }
        return (
          <Space size={4}>
            <Tag color="green">{r.start_time?.slice(0, 5)}</Tag>
            <Tag color="red">{r.mid_time?.slice(0, 5)}</Tag>
            <Tag color="blue">{r.mid_time2?.slice(0, 5)}</Tag>
            <Tag color="red">{r.end_time?.slice(0, 5)}</Tag>
          </Space>
        );
      },
    },
    {
      title: 'Nhân viên',
      key: 'employee_count',
      width: 100,
      align: 'center',
      render: (_, r) => r.employee_count ?? '—',
    },
    {
      title: '',
      key: 'actions',
      width: 150,
      render: (_, r) => (
        <Space>
          <Tooltip title="Sửa ca">
            <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
          </Tooltip>
          <Tooltip title="Cài đặt muộn/sớm & phạt">
            <Button size="small" icon={<SettingOutlined />} onClick={() => openSettings(r)}
              style={{ color: '#722ed1', borderColor: '#722ed1' }} />
          </Tooltip>
          <Popconfirm title="Xóa ca này?" onConfirm={() => handleDelete(r.id)} okText="Xóa" cancelText="Hủy">
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>
        <ClockCircleOutlined /> Quản lý ca làm việc
      </Title>

      <Card
        bordered={false}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Tạo ca mới
          </Button>
        }
      >
        <Table
          columns={columns}
          dataSource={shifts}
          rowKey="id"
          loading={loading}
          pagination={false}
          size="middle"
        />
      </Card>

      {/* ── Modal tạo/sửa ca ── */}
      <Modal
        open={modal}
        title={editing ? 'Sửa ca làm việc' : 'Tạo ca làm việc'}
        onCancel={() => setModal(false)}
        onOk={handleSave}
        okText={editing ? 'Cập nhật' : 'Tạo'}
        cancelText="Hủy"
        forceRender
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="Tên ca" rules={[{ required: true, message: 'Nhập tên ca' }]}> 
            <Input placeholder="VD: Ca hành chính, Ca gãy..." />
          </Form.Item>

          <Form.Item name="shift_type" label="Loại ca" rules={[{ required: true }]}>
            <Select
              options={Object.entries(SHIFT_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v }))}
              onChange={v => setShiftType(v)}
            />
          </Form.Item>

          {shiftType === 'hc' && (
            <Space size="large">
              <Form.Item name="start_time" label="Giờ bắt đầu" rules={[{ required: true, message: 'Chọn giờ' }]}>
                <TimePicker format={TIME_FORMAT} minuteStep={5} />
              </Form.Item>
              <Form.Item name="end_time" label="Giờ kết thúc" rules={[{ required: true, message: 'Chọn giờ' }]}>
                <TimePicker format={TIME_FORMAT} minuteStep={5} />
              </Form.Item>
            </Space>
          )}

          {shiftType === '3punch' && (
            <Space size="large">
              <Form.Item name="start_time" label="Giờ bắt đầu" rules={[{ required: true, message: 'Chọn giờ' }]}>
                <TimePicker format={TIME_FORMAT} minuteStep={5} />
              </Form.Item>
              <Form.Item name="mid_time" label="Giờ giữa ca" rules={[{ required: true, message: 'Chọn giờ' }]}>
                <TimePicker format={TIME_FORMAT} minuteStep={5} />
              </Form.Item>
              <Form.Item name="end_time" label="Giờ kết thúc" rules={[{ required: true, message: 'Chọn giờ' }]}>
                <TimePicker format={TIME_FORMAT} minuteStep={5} />
              </Form.Item>
            </Space>
          )}

          {shiftType === '4punch' && (
            <>
              <Space size="large">
                <Form.Item name="start_time" label="Vào ca 1" rules={[{ required: true, message: 'Chọn giờ' }]}>
                  <TimePicker format={TIME_FORMAT} minuteStep={5} />
                </Form.Item>
                <Form.Item name="mid_time" label="Ra ca 1" rules={[{ required: true, message: 'Chọn giờ' }]}>
                  <TimePicker format={TIME_FORMAT} minuteStep={5} />
                </Form.Item>
              </Space>
              <Space size="large">
                <Form.Item name="mid_time2" label="Vào ca 2" rules={[{ required: true, message: 'Chọn giờ' }]}>
                  <TimePicker format={TIME_FORMAT} minuteStep={5} />
                </Form.Item>
                <Form.Item name="end_time" label="Ra ca 2" rules={[{ required: true, message: 'Chọn giờ' }]}>
                  <TimePicker format={TIME_FORMAT} minuteStep={5} />
                </Form.Item>
              </Space>
            </>
          )}
        </Form>
      </Modal>

      {/* ── Drawer cài đặt muộn/sớm & phạt ── */}
      <Drawer
        title={settingsShift ? `Cài đặt: ${settingsShift.name}` : 'Cài đặt'}
        open={!!settingsShift}
        onClose={() => setSettingsShift(null)}
        width={640}
        extra={
          <Button type="primary" onClick={handleSaveSettings} loading={settingsLoading}>
            Lưu cấu hình
          </Button>
        }
      >
        {settingsShift && (
          <Tabs
            defaultActiveKey="rules"
            items={[
              {
                key: 'rules',
                label: '⏰ Mốc đi muộn / về sớm',
                children: (
                  <div>
                    <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                      Cài đặt các mốc thời gian đi muộn và về sớm (tính bằng phút).
                      Để trống "Đến" nghĩa là không giới hạn trên.
                    </Text>
                    {renderRuleEditor('late', lateRules)}
                    <Divider />
                    {renderRuleEditor('early', earlyRules)}
                  </div>
                ),
              },
              {
                key: 'penalties',
                label: '💰 Tiền phạt',
                children: (
                  <div>
                    <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
                      Cài đặt tiền phạt theo số lần đi muộn / về sớm trong tháng.
                      Để trống "Đến lần" nghĩa là từ lần đó trở đi.
                    </Text>
                    {renderPenaltyEditor('late', latePenalties)}
                    <Divider />
                    {renderPenaltyEditor('early', earlyPenalties)}
                  </div>
                ),
              },
            ]}
          />
        )}
      </Drawer>
    </div>
  );
}
