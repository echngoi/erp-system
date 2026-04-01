import { useEffect, useState } from 'react';
import {
  Card, Row, Col, Button, Space, Typography, Descriptions,
  Tag, message, Popconfirm, Alert, Spin, Divider, List
} from 'antd';
import {
  SyncOutlined, PoweroffOutlined, ClockCircleOutlined,
  CheckCircleOutlined, CloseCircleOutlined, HistoryOutlined,
  CloudServerOutlined, InfoCircleOutlined, DeleteOutlined, TeamOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { getDeviceStatus, getDeviceTime, syncDeviceTime, restartDevice, getSyncLogs, getDeviceProtocol, sendDeviceCommand, getCommandStatus } from '../../services/attendanceApi';

const { Text, Title } = Typography;

export default function DeviceSettings() {
  const [device, setDevice]     = useState(null);
  const [time, setTime]         = useState(null);
  const [syncLogs, setSyncLogs] = useState([]);
  const [protocol, setProtocol] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [syncing, setSyncing]   = useState(false);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [d, t, l, p] = await Promise.all([
        getDeviceStatus(), getDeviceTime(), getSyncLogs(), getDeviceProtocol()
      ]);
      setDevice(d.data);
      setTime(t.data);
      setSyncLogs(l.data.results || []);
      setProtocol(p.data);
    } catch (e) {
      message.error('Không thể tải thông tin thiết bị: ' + (e.response?.data?.error || e.message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const handleSyncTime = async () => {
    setSyncing(true);
    try {
      const res = await syncDeviceTime();
      message.success(res.data.message);
      loadAll();
    } catch (e) {
      message.error(e.response?.data?.error || 'Lỗi đồng bộ thời gian');
    } finally {
      setSyncing(false);
    }
  };

  const handleRestart = async () => {
    try {
      await restartDevice();
      message.success('Đã gửi lệnh khởi động lại');
    } catch (e) {
      message.error(e.response?.data?.error || 'Lỗi khởi động lại');
    }
  };

  const handleDeviceCommand = async (cmd, label) => {
    try {
      const res = await sendDeviceCommand(cmd);
      message.info(res.data.message);

      // Poll for device response (heartbeat every ~20s)
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const status = await getCommandStatus();
          const results = status.data.results || [];
          // Look for a result matching our command
          const match = results.find(r => r.cmd === cmd);
          if (match) {
            clearInterval(poll);
            if (match.result === true || match.result === 1) {
              message.success(`${label}: thành công!`);
              loadAll(); // Refresh device stats
            } else {
              message.error(`${label}: thất bại — ${match.msg || 'Không rõ lỗi'}`);
            }
          } else if (attempts >= 6) {
            clearInterval(poll);
            message.warning(`${label}: chưa nhận phản hồi sau 30s. Kiểm tra lại sau.`);
          }
        } catch {
          // Ignore poll errors
        }
      }, 5000);
    } catch (e) {
      message.error(e.response?.data?.error || `Lỗi gửi lệnh ${label}`);
    }
  };

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '80px auto' }} />;

  const isOnline = device?.status === 'connected';
  const isAdms   = protocol?.protocol === 'adms' || device?.status === 'adms_mode';

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Title level={3}>Cài đặt & Thiết bị</Title>

      {/* ADMS Setup Guide */}
      {isAdms && (
        <Alert
          type="info"
          icon={<CloudServerOutlined />}
          showIcon
          message="Chế độ ADMS (Push Mode)"
          description={
            <Space direction="vertical" size="small" style={{ marginTop: 4 }}>
              <Text>
                Máy chấm công đang dùng chế độ ADMS — máy <Text strong>tự đẩy</Text> dữ liệu chấm công về server.
              </Text>
              <Text strong>Cấu hình trên máy chấm công:</Text>
              <Text>
                Menu → Comm. → Cloud Server Setting:
              </Text>
              <Descriptions bordered column={1} size="small" style={{ maxWidth: 500 }}>
                <Descriptions.Item label="Domain / IP">
                  <Text copyable code>{protocol?.server_ip || 'IP_CỦA_MÁY_TÍNH'}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="Port">
                  <Text copyable code>8000</Text>
                </Descriptions.Item>
              </Descriptions>
              <Text type="secondary">
                <InfoCircleOutlined /> Sau khi cấu hình, máy sẽ tự kết nối và đẩy dữ liệu chấm công.
                Kiểm tra log đồng bộ bên dưới để xác nhận.
              </Text>
            </Space>
          }
        />
      )}

      <Row gutter={16}>
        {/* Device info */}
        <Col span={14}>
          <Card
            title={<Space><CheckCircleOutlined />Thông tin thiết bị</Space>}
            bordered={false}
            extra={
              <Tag
                icon={isOnline ? <CheckCircleOutlined /> : isAdms ? <CloudServerOutlined /> : <CloseCircleOutlined />}
                color={isOnline ? 'success' : isAdms ? 'processing' : 'error'}
              >
                {isOnline ? 'Online' : isAdms ? 'ADMS chờ kết nối' : 'Mất kết nối'}
              </Tag>
            }
          >
            {!isOnline && !isAdms && (
              <Alert
                type="error"
                message={`Không thể kết nối đến ${device?.ip}:${device?.port}`}
                description={device?.error}
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}
              {isAdms && device?.status === 'connected' && (
              <Alert
                type="success"
                message="Thiết bị đang kết nối và push dữ liệu"
                description={`${device?.device_name || 'Máy chấm công'} (${device?.device_ip}) đang online qua WebSocket.`}
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}
            {isAdms && device?.status === 'waiting' && (
              <Alert
                type="warning"
                message="Đang chờ máy chấm công kết nối"
                description={device?.note}
                showIcon
                style={{ marginBottom: 16 }}
              />
            )}
            <Descriptions bordered column={1} size="small">
              <Descriptions.Item label="Model">Ronald Jack AI06F</Descriptions.Item>
              <Descriptions.Item label="Giao thức">
                <Tag color={isAdms ? 'blue' : 'green'}>
                  {isAdms ? 'ADMS Push (WebSocket)' : 'ZKTeco Binary (pyzk)'}
                </Tag>
              </Descriptions.Item>
              <Descriptions.Item label="Địa chỉ IP">
                <Text copyable code>{device?.ip}:{device?.port}</Text>
              </Descriptions.Item>
              {(isOnline || isAdms) && <>
                <Descriptions.Item label="Tên thiết bị">{device?.device_name || '—'}</Descriptions.Item>
                <Descriptions.Item label="Số Serial">{device?.serial_number || '—'}</Descriptions.Item>
                <Descriptions.Item label="Firmware">{device?.firmware || '—'}</Descriptions.Item>
                {device?.device_ip && (
                  <Descriptions.Item label="IP thiết bị">{device.device_ip}</Descriptions.Item>
                )}
                {device?.last_push && (
                  <Descriptions.Item label="Lần push cuối">
                    {device.last_push}
                    {device.last_push_seconds_ago != null && (
                      <Tag color={device.last_push_seconds_ago < 60 ? 'success' : 'warning'} style={{ marginLeft: 8 }}>
                        {device.last_push_seconds_ago < 60
                          ? `${device.last_push_seconds_ago}s trước`
                          : `${Math.round(device.last_push_seconds_ago / 60)} phút trước`}
                      </Tag>
                    )}
                  </Descriptions.Item>
                )}
              </>}
              {device?.device_stats && (
                <>
                  <Descriptions.Item label="Users trên máy">{device.device_stats.total_users}</Descriptions.Item>
                  <Descriptions.Item label="Khuôn mặt">{device.device_stats.total_faces}</Descriptions.Item>
                  <Descriptions.Item label="Vân tay">{device.device_stats.total_fingerprints}</Descriptions.Item>
                  <Descriptions.Item label="Tổng log trên máy">{device.device_stats.total_logs?.toLocaleString()}</Descriptions.Item>
                  <Descriptions.Item label="Log mới (chưa xóa)">{device.device_stats.new_logs}</Descriptions.Item>
                </>
              )}
              {device?.note && (
                <Descriptions.Item label="Ghi chú">{device.note}</Descriptions.Item>
              )}
            </Descriptions>

            {(isOnline || isAdms) && (
              <>
                <Divider />
                <Space wrap>
                  <Button
                    icon={<SyncOutlined spin={syncing} />}
                    onClick={handleSyncTime}
                    loading={syncing}
                  >
                    Đồng bộ giờ thiết bị
                  </Button>
                  <Popconfirm
                    title="Xóa log đã đọc trên máy chấm công?"
                    description="Xóa log đã sync trên máy để giải phóng bộ nhớ. Dữ liệu server không bị ảnh hưởng."
                    onConfirm={() => handleDeviceCommand('clearlog', 'Xóa log')}
                    okText="Xóa log" cancelText="Hủy"
                    okButtonProps={{ danger: true }}
                  >
                    <Button icon={<DeleteOutlined />} danger>
                      Xóa log máy
                    </Button>
                  </Popconfirm>
                  <Popconfirm
                    title="Lấy danh sách user từ máy?"
                    description="Server sẽ yêu cầu máy gửi lại toàn bộ danh sách nhân viên."
                    onConfirm={() => handleDeviceCommand('getuser', 'Lấy user')}
                    okText="Lấy user" cancelText="Hủy"
                  >
                    <Button icon={<TeamOutlined />}>
                      Lấy user từ máy
                    </Button>
                  </Popconfirm>
                  <Popconfirm
                    title="Khởi động lại thiết bị?"
                    description="Máy sẽ khởi động lại và mất vài giây."
                    onConfirm={() => handleDeviceCommand('reboot', 'Khởi động lại')}
                    okText="Khởi động" cancelText="Hủy"
                    okButtonProps={{ danger: true }}
                  >
                    <Button icon={<PoweroffOutlined />} danger>
                      Khởi động lại
                    </Button>
                  </Popconfirm>
                  <Button icon={<SyncOutlined />} onClick={loadAll}>
                    Làm mới
                  </Button>
                </Space>
              </>
            )}
          </Card>
        </Col>

        {/* Time info */}
        <Col span={10}>
          <Card
            title={<Space><ClockCircleOutlined />Đồng hồ thiết bị</Space>}
            bordered={false}
          >
            {time ? (
              <Descriptions bordered column={1} size="small">
                <Descriptions.Item label="Giờ máy chấm công">
                  <Text strong style={{ fontSize: 16 }}>
                    {time.device_time || <Text type="warning">N/A</Text>}
                  </Text>
                </Descriptions.Item>
                <Descriptions.Item label="Giờ máy chủ">
                  <Text strong>{time.server_time}</Text>
                </Descriptions.Item>
                <Descriptions.Item label="Chênh lệch">
                  {time.device_time && time.server_time ? (() => {
                    const diff = Math.abs(
                      dayjs(time.server_time).diff(dayjs(time.device_time), 'second')
                    );
                    return (
                      <Tag color={diff < 60 ? 'success' : 'warning'}>
                        {diff < 60 ? `${diff}s` : `${Math.round(diff / 60)} phút`}
                      </Tag>
                    );
                  })() : '—'}
                </Descriptions.Item>
              </Descriptions>
            ) : (
              <Text type="secondary">Không đọc được giờ thiết bị</Text>
            )}
          </Card>
        </Col>
      </Row>

      {/* Sync history */}
      <Card
        title={<Space><HistoryOutlined />Lịch sử đồng bộ</Space>}
        bordered={false}
      >
        <List
          dataSource={syncLogs}
          renderItem={log => (
            <List.Item key={log.id}>
              <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                <Space>
                  <Tag color={log.status === 'success' ? 'green' : log.status === 'failed' ? 'red' : 'orange'}>
                    {log.status === 'success' ? 'Thành công' : log.status === 'failed' ? 'Thất bại' : 'Một phần'}
                  </Tag>
                  <Text>{log.records_synced} bản ghi</Text>
                  {log.duration && <Text type="secondary">({log.duration}s)</Text>}
                  {log.error_message && <Text type="danger" ellipsis style={{ maxWidth: 300 }}>{log.error_message}</Text>}
                </Space>
                <Text type="secondary">{dayjs(log.started_at).format('DD/MM/YYYY HH:mm:ss')}</Text>
              </Space>
            </List.Item>
          )}
          locale={{ emptyText: 'Chưa có lịch sử đồng bộ' }}
        />
      </Card>
    </Space>
  );
}
