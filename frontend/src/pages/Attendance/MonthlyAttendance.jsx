import { useState, useEffect, useCallback } from 'react';
import {
  Card, DatePicker, Select, Button, Row, Col, Typography, message,
  Space, Tooltip, Spin, Tag, Statistic, Empty, Alert, Tabs, Table,
} from 'antd';
import {
  CalendarOutlined, SearchOutlined, CheckCircleOutlined,
  CloseCircleOutlined, UserOutlined, PrinterOutlined,
  WarningOutlined, DollarOutlined, FileExcelOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { getAttendanceReport, getEmployees, getMyAttendanceInfo, exportAttendanceReport } from '../../services/attendanceApi';

const { Title, Text } = Typography;

/* ── helpers ─────────────────────────────────────────── */
const DAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

function daysInMonth(month /* dayjs */) {
  const total = month.daysInMonth();
  const arr = [];
  for (let d = 1; d <= total; d++) {
    const dt = month.date(d);
    arr.push({ day: d, dow: dt.day(), date: dt.format('YYYY-MM-DD'), isWeekend: dt.day() === 0 || dt.day() === 6 });
  }
  return arr;
}

/** Lọc lần chấm công theo loại ca: lấy lần đầu + N-1 lần cuối */
function filterPunches(punches, shift) {
  if (!punches || punches.length === 0) return punches;
  let maxPunches = 2; // mặc định ca HC
  if (shift) {
    if (shift.type === '3punch') maxPunches = 3;
    else if (shift.type === '4punch') maxPunches = 4;
  }
  if (punches.length <= maxPunches) return punches;
  // Lần đầu tiên + (maxPunches - 1) lần cuối cùng
  return [punches[0], ...punches.slice(-(maxPunches - 1))];
}

/* ── component ───────────────────────────────────────── */
export default function MonthlyAttendance() {
  const [month, setMonth]             = useState(dayjs().startOf('month'));
  const [employees, setEmployees]     = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [loading, setLoading]         = useState(false);
  const [exporting, setExporting]     = useState(false);
  const [reportData, setReportData]   = useState(null);
  const [attInfo, setAttInfo]         = useState(null);

  const canViewAll = attInfo?.view_all_pages?.includes('monthly');

  useEffect(() => {
    getMyAttendanceInfo().then(r => setAttInfo(r.data)).catch(() => {});
  }, []);

  useEffect(() => {
    if (canViewAll) {
      getEmployees().then(r => setEmployees(r.data.results || [])).catch(() => {});
    }
  }, [canViewAll]);

  const days = daysInMonth(month);

  const fetchReport = useCallback(async () => {
    if (!attInfo) return;  // wait for info to load
    setLoading(true);
    try {
      const params = {
        date_from: month.startOf('month').format('YYYY-MM-DD'),
        date_to:   month.endOf('month').format('YYYY-MM-DD'),
        _page: 'monthly',
      };
      if (canViewAll && selectedUser) params.user_id = selectedUser;
      const res = await getAttendanceReport(params);
      setReportData(res.data);
    } catch {
      message.error('Không thể tải dữ liệu chấm công');
    } finally {
      setLoading(false);
    }
  }, [month, selectedUser, attInfo, canViewAll]);

  useEffect(() => { fetchReport(); }, [fetchReport]);

  /* Build lookup: user_id → { 'YYYY-MM-DD': dayObj } */
  const lookup = {};
  if (reportData) {
    for (const emp of reportData.employees) {
      const map = {};
      for (const d of emp.daily) map[d.date] = d;
      lookup[emp.user_id] = { ...emp, dayMap: map };
    }
  }

  const empList = reportData ? reportData.employees : [];

  /* aggregate stats */
  const totalPresent = empList.reduce((s, e) => s + e.summary.present, 0);
  const totalAbsent  = empList.reduce((s, e) => s + e.summary.absent, 0);
  const totalLate    = empList.reduce((s, e) => s + e.summary.late, 0);

  const handlePrint = () => window.print();

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = {
        date_from: month.startOf('month').format('YYYY-MM-DD'),
        date_to:   month.endOf('month').format('YYYY-MM-DD'),
        _page: 'monthly',
      };
      if (canViewAll && selectedUser) params.user_id = selectedUser;
      const res = await exportAttendanceReport(params);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `BangCong_${month.format('MM_YYYY')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      message.success('Xuất Excel thành công');
    } catch {
      message.error('Xuất Excel thất bại');
    } finally {
      setExporting(false);
    }
  };

  /* ── render ──────────────────────────────────────────── */
  return (
    <div>
      {/* Print-only styles */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .monthly-print, .monthly-print * { visibility: visible; }
          .monthly-print { position: absolute; left: 0; top: 0; width: 100%; }
          .no-print { display: none !important; }
        }
        .att-table { border-collapse: collapse; width: 100%; font-size: 12px; }
        .att-table th, .att-table td { border: 1px solid #e8e8e8; text-align: center; padding: 0; }
        .att-table th { background: #fafafa; font-weight: 600; position: sticky; top: 0; z-index: 2; }
        .att-table th.day-header { width: 44px; min-width: 44px; padding: 4px 0; font-size: 11px; }
        .att-table th.day-header.weekend { background: #fff1f0; color: #ff4d4f; }
        .att-table td.name-cell { text-align: left; padding: 4px 8px; white-space: nowrap; font-weight: 500;
          position: sticky; left: 0; background: #fff; z-index: 1; min-width: 160px; }
        .att-table td.stt-cell { padding: 4px 6px; position: sticky; left: 0; background: #fff; z-index: 1; width: 40px; }
        .att-table th.name-header { text-align: left; padding: 4px 8px; position: sticky; left: 0; background: #fafafa; z-index: 3; min-width: 160px; }
        .att-table th.stt-header { position: sticky; left: 0; background: #fafafa; z-index: 3; width: 40px; }
        .att-table td.day-cell { padding: 2px; vertical-align: top; height: 52px; width: 44px; cursor: default; }
        .att-table td.day-cell.multi-punch { height: 68px; }
        .att-table td.day-cell.weekend { background: #fffbe6; }
        .att-table td.day-cell.present { background: #f6ffed; }
        .att-table td.day-cell.absent  { background: #fff1f0; }
        .att-table td.day-cell.late    { background: #fff7e6; }
        .att-table td.day-cell.future  { background: #fafafa; }
        .att-table td.summary-cell { padding: 4px 6px; font-weight: 600; }
        .cell-check-in  { color: #389e0d; font-size: 11px; line-height: 1.3; }
        .cell-check-out { color: #cf1322; font-size: 11px; line-height: 1.3; }
        .cell-badge { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 2px; }
        .cell-badge.green  { background: #52c41a; }
        .cell-badge.red    { background: #ff4d4f; }
        .cell-badge.orange { background: #fa8c16; }
        .cell-badge.gray   { background: #d9d9d9; }
        .att-table tr:hover td { background: #e6f7ff !important; }
        .att-table tr:hover td.name-cell,
        .att-table tr:hover td.stt-cell { background: #e6f7ff !important; }
      `}</style>

      <Title level={4} style={{ marginBottom: 16 }}>
        <CalendarOutlined /> Bảng chấm công tháng
      </Title>

      {/* ── No mapping alert ── */}
      {attInfo && !canViewAll && !attInfo.attendance_employee_id && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="Tài khoản của bạn chưa được liên kết với nhân viên chấm công. Hãy liên hệ quản trị viên."
        />
      )}

      {/* ── Filters ── */}
      <Card size="small" style={{ marginBottom: 16 }} className="no-print">
        <Row gutter={[16, 12]} align="middle">
          <Col>
            <Text type="secondary" style={{ marginRight: 8 }}>Tháng:</Text>
            <DatePicker
              picker="month"
              value={month}
              onChange={v => v && setMonth(v.startOf('month'))}
              format="MM/YYYY"
              allowClear={false}
            />
          </Col>
          {canViewAll && (
            <Col>
              <Text type="secondary" style={{ marginRight: 8 }}>Nhân viên:</Text>
              <Select
                allowClear
                placeholder="Tất cả nhân viên"
                style={{ width: 240 }}
                value={selectedUser}
                onChange={setSelectedUser}
                showSearch
                optionFilterProp="label"
                options={employees.map(e => ({ value: e.user_id, label: `${e.user_id} - ${e.display_name}` }))}
              />
            </Col>
          )}
          <Col>
            <Space>
              <Button type="primary" icon={<SearchOutlined />} onClick={fetchReport} loading={loading}>
                Xem
              </Button>
              <Button icon={<PrinterOutlined />} onClick={handlePrint}>
                In
              </Button>
              {canViewAll && (
                <Button icon={<FileExcelOutlined />} onClick={handleExport} loading={exporting}
                  style={{ color: '#217346', borderColor: '#217346' }}>
                  Xuất Excel
                </Button>
              )}
            </Space>
          </Col>
        </Row>
      </Card>

      {/* ── Stats ── */}
      {reportData && (
        <Row gutter={16} style={{ marginBottom: 16 }} className="no-print">
          <Col xs={8} md={4}>
            <Card size="small">
              <Statistic title="Nhân viên" value={empList.length} prefix={<UserOutlined />} />
            </Card>
          </Col>
          <Col xs={8} md={4}>
            <Card size="small">
              <Statistic title="Tổng đi làm" value={totalPresent}
                valueStyle={{ color: '#52c41a' }} prefix={<CheckCircleOutlined />} />
            </Card>
          </Col>
          <Col xs={8} md={4}>
            <Card size="small">
              <Statistic title="Tổng vắng" value={totalAbsent}
                valueStyle={{ color: '#ff4d4f' }} prefix={<CloseCircleOutlined />} />
            </Card>
          </Col>
          <Col xs={8} md={4}>
            <Card size="small">
              <Statistic title="Đi muộn" value={totalLate}
                valueStyle={{ color: '#fa8c16' }} />
            </Card>
          </Col>
        </Row>
      )}

      {/* ── Tabs: Bảng chấm công + Đi muộn về sớm ── */}
      <Tabs defaultActiveKey="grid" items={[
        {
          key: 'grid',
          label: <span><CalendarOutlined /> Bảng chấm công</span>,
          children: (
            <Card
              size="small"
              title={
                <Space>
                  <CalendarOutlined />
                  <span>Bảng chấm công tháng {month.format('MM/YYYY')}</span>
                  <Tag color="green"><span className="cell-badge green" /> Đi làm</Tag>
                  <Tag color="red"><span className="cell-badge red" /> Vắng</Tag>
                  <Tag color="orange"><span className="cell-badge orange" /> Đi muộn</Tag>
                </Space>
              }
              styles={{ body: { padding: 0, overflow: 'auto' } }}
            >
              <Spin spinning={loading}>
                {empList.length === 0 && !loading ? (
                  <Empty description="Không có dữ liệu" style={{ padding: 40 }} />
                ) : (
                  <div className="monthly-print" style={{ overflowX: 'auto' }}>
                    <table className="att-table">
                      <thead>
                        <tr>
                          <th className="stt-header" rowSpan={2}>STT</th>
                          <th className="name-header" rowSpan={2}>Họ tên</th>
                          {days.map(d => (
                            <th key={d.day} className={`day-header${d.isWeekend ? ' weekend' : ''}`}>
                              {DAY_LABELS[d.dow]}
                            </th>
                          ))}
                          <th rowSpan={2} style={{ width: 55, padding: '4px 2px', fontSize: 11 }}>Đi làm</th>
                          <th rowSpan={2} style={{ width: 50, padding: '4px 2px', fontSize: 11 }}>Vắng</th>
                        </tr>
                        <tr>
                          {days.map(d => (
                            <th key={d.day} className={`day-header${d.isWeekend ? ' weekend' : ''}`}>
                              {d.day}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {empList.map((emp, idx) => {
                          const dayMap = lookup[emp.user_id]?.dayMap || {};
                          const today = dayjs().format('YYYY-MM-DD');
                          return (
                            <tr key={emp.user_id}>
                              <td className="stt-cell">{idx + 1}</td>
                              <td className="name-cell">
                                <div style={{ fontSize: 12 }}>{emp.employee_name}</div>
                                {emp.employee_code && <div style={{ fontSize: 10, color: '#1677ff' }}>Mã NV: {emp.employee_code}</div>}
                                {emp.department && <div style={{ fontSize: 10, color: '#888' }}>{emp.department}</div>}
                                {emp.shift && <div style={{ fontSize: 10, color: '#722ed1' }}>{emp.shift.name}</div>}
                                <div style={{ fontSize: 10, color: '#999' }}>{emp.username ? `TK: ${emp.username}` : `ID: ${emp.user_id}`}</div>
                              </td>
                              {days.map(d => {
                                const info = dayMap[d.date];
                                const isFuture = d.date > today;

                                if (isFuture) {
                                  return (
                                    <td key={d.day} className="day-cell future">
                                      <span className="cell-badge gray" />
                                    </td>
                                  );
                                }

                                if (!info || info.status === 'absent') {
                                  if (d.isWeekend) {
                                    return (
                                      <td key={d.day} className="day-cell weekend">
                                        <span style={{ color: '#bbb', fontSize: 10 }}>—</span>
                                      </td>
                                    );
                                  }
                                  return (
                                    <Tooltip key={d.day} title={`${d.date} — Vắng mặt`}>
                                      <td className="day-cell absent">
                                        <span className="cell-badge red" />
                                        <div style={{ color: '#ff4d4f', fontSize: 10, fontWeight: 600 }}>Vắng</div>
                                      </td>
                                    </Tooltip>
                                  );
                                }

                                const isLate = info.status === 'late' || info.status === 'late+early';
                                const cellClass = isLate ? 'late' : 'present';
                                const rawPunches = info.punches || [];
                                const punches = filterPunches(rawPunches, emp.shift);
                                const isMulti = punches.length > 2;

                                return (
                                  <Tooltip
                                    key={d.day}
                                    title={
                                      <div style={{ fontSize: 12 }}>
                                        <div><b>{dayjs(d.date).format('DD/MM/YYYY')}</b></div>
                                        {punches.length > 0 ? punches.map((p, i) => (
                                          <div key={i}>Lần {i + 1}: <b>{p}</b></div>
                                        )) : (
                                          <>
                                            <div>Vào: <b>{info.check_in || '—'}</b></div>
                                            <div>Ra: <b>{info.check_out || '—'}</b></div>
                                          </>
                                        )}
                                        {rawPunches.length > punches.length && (
                                          <div style={{ color: '#999', fontSize: 11 }}>({rawPunches.length} lần chấm, hiển thị {punches.length})</div>
                                        )}
                                        {info.late_minutes > 0 && <div style={{ color: '#faad14' }}>Muộn: {info.late_minutes} phút{info.late_label ? ` (${info.late_label})` : ''}</div>}
                                        {info.early_minutes > 0 && <div style={{ color: '#1890ff' }}>Sớm: {info.early_minutes} phút{info.early_label ? ` (${info.early_label})` : ''}</div>}
                                        {info.ot_minutes > 0 && <div style={{ color: '#722ed1' }}>OT: {info.ot_minutes} phút</div>}
                                        {info.work_minutes > 0 && <div>Làm: {Math.floor(info.work_minutes / 60)}h{info.work_minutes % 60}p</div>}
                                      </div>
                                    }
                                  >
                                    <td className={`day-cell ${cellClass}${isMulti ? ' multi-punch' : ''}`}>
                                      <span className={`cell-badge ${isLate ? 'orange' : 'green'}`} />
                                      {isMulti ? (
                                        punches.map((p, i) => (
                                          <div key={i} style={{ color: i % 2 === 0 ? '#389e0d' : '#cf1322', fontSize: 10, lineHeight: 1.2 }}>{p.slice(0, 5)}</div>
                                        ))
                                      ) : (
                                        <>
                                          <div className="cell-check-in">{(punches[0] || info.check_in || '—').slice(0, 5)}</div>
                                          <div className="cell-check-out">{(punches[1] || info.check_out || '—').slice(0, 5)}</div>
                                        </>
                                      )}
                                    </td>
                                  </Tooltip>
                                );
                              })}
                              <td className="summary-cell" style={{ color: '#52c41a' }}>{emp.summary.present}</td>
                              <td className="summary-cell" style={{ color: '#ff4d4f' }}>{emp.summary.absent}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Spin>
            </Card>
          ),
        },
        {
          key: 'late-early',
          label: <span><WarningOutlined /> Đi muộn về sớm</span>,
          children: (() => {
            // Build late/early detail data from report
            const lateEarlyData = [];
            for (const emp of empList) {
              for (const d of emp.daily) {
                if (d.late_minutes > 0 || d.early_minutes > 0) {
                  const punches = d.punches || [];
                  lateEarlyData.push({
                    key: `${emp.user_id}_${d.date}`,
                    user_id: emp.user_id,
                    username: emp.username,
                    employee_name: emp.employee_name,
                    department: emp.department,
                    shift_name: emp.shift?.name || '',
                    date: d.date,
                    late_minutes: d.late_minutes,
                    late_label: d.late_label || '',
                    early_minutes: d.early_minutes,
                    early_label: d.early_label || '',
                    check_in: punches[0] || d.check_in,
                    check_out: punches.length > 1 ? punches[punches.length - 1] : d.check_out,
                  });
                }
              }
            }

            const leCols = [
              { title: 'Mã NV', width: 100, render: (_, r) => r.username || r.user_id },
              { title: 'Họ tên', dataIndex: 'employee_name', width: 160 },
              { title: 'Phòng ban', dataIndex: 'department', width: 120 },
              { title: 'Ca', dataIndex: 'shift_name', width: 120 },
              { title: 'Ngày', dataIndex: 'date', width: 110, render: v => dayjs(v).format('DD/MM/YYYY') },
              { title: 'Check-in', dataIndex: 'check_in', width: 90, align: 'center', render: v => v || '—' },
              { title: 'Check-out', dataIndex: 'check_out', width: 90, align: 'center', render: v => v || '—' },
              {
                title: 'Đi muộn', width: 120, align: 'center',
                render: (_, r) => r.late_minutes > 0
                  ? <Tooltip title={r.late_label}><Tag color="orange">{r.late_minutes} phút</Tag></Tooltip>
                  : '—',
              },
              {
                title: 'Về sớm', width: 120, align: 'center',
                render: (_, r) => r.early_minutes > 0
                  ? <Tooltip title={r.early_label}><Tag color="blue">{r.early_minutes} phút</Tag></Tooltip>
                  : '—',
              },
            ];

            // Build penalty summary
            const penaltySummary = empList
              .filter(e => e.summary.total_penalty > 0 || e.summary.late > 0 || e.summary.early_leave > 0)
              .map(e => ({
                key: e.user_id,
                user_id: e.user_id,
                username: e.username,
                employee_name: e.employee_name,
                department: e.department,
                shift_name: e.shift?.name || '',
                late_count: e.summary.late,
                late_minutes: e.summary.late_minutes || 0,
                late_penalty: e.summary.late_penalty || 0,
                early_count: e.summary.early_leave,
                early_minutes: e.summary.early_minutes || 0,
                early_penalty: e.summary.early_penalty || 0,
                total_penalty: e.summary.total_penalty || 0,
              }));

            const penCols = [
              { title: 'Mã NV', width: 100, render: (_, r) => r.username || r.user_id },
              { title: 'Họ tên', dataIndex: 'employee_name', width: 160 },
              { title: 'Ca', dataIndex: 'shift_name', width: 120 },
              { title: 'Số lần muộn', dataIndex: 'late_count', width: 100, align: 'center',
                render: v => v > 0 ? <Tag color="orange">{v} lần</Tag> : '0' },
              { title: 'Tổng phút muộn', dataIndex: 'late_minutes', width: 110, align: 'center',
                render: v => v > 0 ? `${v} phút` : '—' },
              { title: 'Phạt muộn', width: 150, align: 'right',
                render: (_, r) => r.late_penalty > 0
                  ? <Text type="danger">{r.late_penalty.toLocaleString('vi-VN')}₫</Text>
                  : '—' },
              { title: 'Số lần sớm', dataIndex: 'early_count', width: 100, align: 'center',
                render: v => v > 0 ? <Tag color="blue">{v} lần</Tag> : '0' },
              { title: 'Tổng phút sớm', dataIndex: 'early_minutes', width: 110, align: 'center',
                render: v => v > 0 ? `${v} phút` : '—' },
              { title: 'Phạt sớm', width: 150, align: 'right',
                render: (_, r) => r.early_penalty > 0
                  ? <Text type="danger">{r.early_penalty.toLocaleString('vi-VN')}₫</Text>
                  : '—' },
              { title: 'Tổng phạt', dataIndex: 'total_penalty', width: 140, align: 'right',
                render: v => v > 0 ? <Text strong type="danger">{v.toLocaleString('vi-VN')}₫</Text> : '—' },
            ];

            return (
              <div>
                <Card size="small" title={<span><WarningOutlined style={{ color: '#fa8c16' }} /> Chi tiết đi muộn / về sớm</span>}
                  style={{ marginBottom: 16 }}>
                  <Table dataSource={lateEarlyData} columns={leCols} size="small" bordered
                    pagination={{ defaultPageSize: 50, showSizeChanger: true, showTotal: t => `${t} dòng` }}
                    scroll={{ x: 1000 }} />
                </Card>
                {penaltySummary.length > 0 && (
                  <Card size="small" title={<span><DollarOutlined style={{ color: '#722ed1' }} /> Tổng hợp phạt tháng {month.format('MM/YYYY')}</span>}>
                    <Table dataSource={penaltySummary} columns={penCols} size="small" bordered
                      pagination={false} scroll={{ x: 1100 }} />
                  </Card>
                )}
              </div>
            );
          })(),
        },
      ]} />
    </div>
  );
}
