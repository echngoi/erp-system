import { useEffect, useState, useRef, useCallback } from 'react';
import {
  Card, List, Tag, Typography, Space, Badge,
  Button, Alert, Statistic, Row, Col, Timeline, Tooltip
} from 'antd';
import {
  ThunderboltOutlined, WifiOutlined, DisconnectOutlined,
  ClockCircleOutlined, CheckCircleOutlined, SyncOutlined,
  CloudDownloadOutlined
} from '@ant-design/icons';
import dayjs from 'dayjs';

const { Text, Title } = Typography;

const WS_URL = (import.meta.env.VITE_WS_URL || 'ws://localhost:8000') + '/ws/attendance/';

const PUNCH_COLORS = { 0: 'green', 1: 'red', 2: 'orange', 3: 'blue', 4: 'purple', 5: 'volcano' };
const PUNCH_LABELS = { 0: 'Vào ca', 1: 'Ra ca', 2: 'Nghỉ giải lao', 3: 'Trở lại', 4: 'Tăng ca vào', 5: 'Tăng ca ra' };

export default function LiveMonitor() {
  const [connected, setConnected]   = useState(false);
  const [records, setRecords]       = useState([]);
  const [total, setTotal]           = useState(0);
  const [error, setError]           = useState(null);
  const [log, setLog]               = useState([]);
  const [now, setNow]               = useState(dayjs());
  const wsRef                       = useRef(null);

  // Clock
  useEffect(() => {
    const t = setInterval(() => setNow(dayjs()), 1000);
    return () => clearInterval(t);
  }, []);

  const [syncing, setSyncing]       = useState(false);
  const pollRef                      = useRef(null);

  const addLog = useCallback((msg, type = 'info') => {
    setLog(prev => [{ msg, type, time: dayjs().format('HH:mm:ss') }, ...prev].slice(0, 30));
  }, []);

  const mergeRecords = useCallback((incoming, replace = false) => {
    setRecords(prev => {
      const base = replace ? incoming : [...incoming, ...prev];
      const seen = new Set();
      return base.filter(r => {
        const key = `${r.user_id}_${r.timestamp}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 50);
    });
  }, []);

  const connect = () => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setError(null);
      addLog('Kết nối WebSocket thành công', 'success');
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'attendance_update') {
        const incoming = msg.records || [];
        if (msg.total) setTotal(msg.total);
        if (msg.source === 'db_initial' || msg.source === 'db_refresh') {
          mergeRecords(incoming, true);
          addLog(`Đã tải ${incoming.length} bản ghi từ cơ sở dữ liệu`, 'info');
        } else {
          mergeRecords(incoming);
          if (incoming.length) {
            addLog(`+${incoming.length} bản ghi mới từ máy chấm công`, 'success');
          }
        }
      } else if (msg.type === 'error') {
        addLog(`Lỗi: ${msg.message}`, 'error');
      } else if (msg.type === 'connected') {
        addLog(msg.message, 'success');
      } else if (msg.type === 'info') {
        addLog(msg.message, 'info');
      }
    };

    ws.onerror = () => {
      setError('Lỗi kết nối WebSocket. Đảm bảo Django Channels đang chạy.');
      setConnected(false);
    };

    ws.onclose = () => {
      setConnected(false);
      addLog('Mất kết nối WebSocket', 'warning');
    };
  };

  const disconnect = () => {
    wsRef.current?.close();
    setConnected(false);
  };

  /** Gửi lệnh refresh DB qua WebSocket */
  const refreshFromDB = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ action: 'refresh' }));
    }
  }, []);

  /** Gửi lệnh đồng bộ log từ máy chấm công */
  const forceSync = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      setSyncing(true);
      wsRef.current.send(JSON.stringify({ action: 'force_sync' }));
      addLog('Đang yêu cầu máy chấm công gửi lại dữ liệu...', 'info');
      // Auto-refresh from DB after 5s to pick up saved records
      setTimeout(() => {
        refreshFromDB();
        setSyncing(false);
      }, 5000);
    }
  }, [addLog, refreshFromDB]);

  useEffect(() => {
    connect();
    // Polling fallback: refresh from DB every 30s to catch any missed WS events
    pollRef.current = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ action: 'refresh' }));
      }
    }, 30000);
    return () => {
      wsRef.current?.close();
      clearInterval(pollRef.current);
    };
  }, []); // eslint-disable-line

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      {/* Header */}
      <Row gutter={16} align="middle">
        <Col flex="auto">
          <Space align="center">
            <ThunderboltOutlined style={{ fontSize: 24, color: '#faad14' }} />
            <Title level={3} style={{ margin: 0 }}>Giám sát trực tiếp</Title>
            <Badge
              status={connected ? 'processing' : 'default'}
              text={
                <Text style={{ color: connected ? '#52c41a' : '#999' }}>
                  {connected ? 'Đang kết nối' : 'Ngắt kết nối'}
                </Text>
              }
            />
          </Space>
        </Col>
        <Col>
          <Space>
            <Text style={{ fontSize: 28, fontWeight: 700, fontFamily: 'monospace', color: '#1677ff' }}>
              {now.format('HH:mm:ss')}
            </Text>
            <Text type="secondary">{now.format('DD/MM/YYYY')}</Text>
            <Tooltip title="Tải lại dữ liệu mới nhất từ DB">
              <Button
                icon={<SyncOutlined spin={syncing} />}
                onClick={refreshFromDB}
                disabled={!connected}
              >
                Làm mới
              </Button>
            </Tooltip>
            <Tooltip title="Yêu cầu máy chấm công gửi lại toàn bộ log">
              <Button
                icon={<CloudDownloadOutlined />}
                type="primary"
                onClick={forceSync}
                loading={syncing}
                disabled={!connected}
              >
                Đồng bộ máy
              </Button>
            </Tooltip>
            {connected
              ? <Button icon={<DisconnectOutlined />} danger onClick={disconnect}>Ngắt</Button>
              : <Button icon={<WifiOutlined />} type="primary" onClick={connect}>Kết nối</Button>
            }
          </Space>
        </Col>
      </Row>

      {error && <Alert type="error" message={error} showIcon closable />}

      {/* Stats */}
      <Row gutter={16}>
        <Col span={8}>
          <Card bordered={false} style={{ background: 'linear-gradient(135deg,#e6f7ff,#bae7ff)', border: '1px solid #91d5ff' }}>
            <Statistic
              title="Tổng bản ghi trên máy"
              value={total}
              prefix={<CheckCircleOutlined style={{ color: '#1677ff' }} />}
              valueStyle={{ color: '#1677ff', fontWeight: 700 }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card bordered={false} style={{ background: 'linear-gradient(135deg,#f6ffed,#d9f7be)', border: '1px solid #b7eb8f' }}>
            <Statistic
              title="Bản ghi mới nhất"
              value={records[0]?.timestamp ? dayjs(records[0].timestamp).format('HH:mm DD/MM') : '—'}
              prefix={<ClockCircleOutlined style={{ color: '#52c41a' }} />}
              valueStyle={{ color: '#52c41a', fontWeight: 700, fontSize: 20 }}
            />
          </Card>
        </Col>
        <Col span={8}>
          <Card bordered={false} style={{ background: 'linear-gradient(135deg,#fff7e6,#ffe7ba)', border: '1px solid #ffd591' }}>
            <Statistic
              title="Trạng thái kết nối"
              value={connected ? 'Đang theo dõi' : 'Chưa kết nối'}
              prefix={connected
                ? <WifiOutlined style={{ color: '#fa8c16' }} />
                : <DisconnectOutlined style={{ color: '#999' }} />
              }
              valueStyle={{ color: connected ? '#fa8c16' : '#999', fontWeight: 700, fontSize: 18 }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        {/* Latest records */}
        <Col span={14}>
          <Card
            title={<Space><ThunderboltOutlined /><span>Bản ghi chấm công gần nhất</span></Space>}
            bordered={false}
          >
            {records.length === 0
              ? <Text type="secondary">Chưa có dữ liệu. {connected ? 'Đang chờ cập nhật...' : 'Hãy kết nối để bắt đầu theo dõi.'}</Text>
              : (
                <List
                  dataSource={records}
                  renderItem={r => (
                    <List.Item key={`${r.user_id}-${r.timestamp}`}>
                      <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                        <Space>
                          <Text strong style={{ fontSize: 16 }}>
                            {r.employee_name || `ID: ${r.user_id}`}
                          </Text>
                          <Text type="secondary" style={{ fontSize: 12 }}>({r.user_id})</Text>
                          {r.department && <Tag>{r.department}</Tag>}
                          <Tag color={PUNCH_COLORS[r.punch] || 'default'}>
                            {PUNCH_LABELS[r.punch] || r.punch_type}
                          </Tag>
                        </Space>
                        <Text type="secondary">{r.timestamp}</Text>
                      </Space>
                    </List.Item>
                  )}
                />
              )
            }
          </Card>
        </Col>

        {/* Activity log */}
        <Col span={10}>
          <Card
            title="Nhật ký hoạt động"
            bordered={false}
            style={{ maxHeight: 400, overflow: 'auto' }}
          >
            <Timeline
              items={log.map(l => ({
                color: l.type === 'success' ? 'green' : l.type === 'error' ? 'red' : l.type === 'warning' ? 'orange' : 'blue',
                children: (
                  <Space>
                    <Text type="secondary" style={{ fontSize: 11 }}>[{l.time}]</Text>
                    <Text style={{ fontSize: 13 }}>{l.msg}</Text>
                  </Space>
                )
              }))}
            />
            {log.length === 0 && <Text type="secondary">Chưa có hoạt động nào.</Text>}
          </Card>
        </Col>
      </Row>
    </Space>
  );
}
