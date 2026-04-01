import api from './api';

const ATTENDANCE_BASE = '/attendance';

// ── Device ──────────────────────────────────────────────
export const getDeviceStatus   = () => api.get(`${ATTENDANCE_BASE}/device/status/`);
export const getDeviceTime     = () => api.get(`${ATTENDANCE_BASE}/device/time/`);
export const syncDeviceTime    = () => api.post(`${ATTENDANCE_BASE}/device/time/`);
export const restartDevice     = () => api.post(`${ATTENDANCE_BASE}/device/restart/`);
export const getDeviceProtocol = () => api.get(`${ATTENDANCE_BASE}/device/protocol/`);
export const sendDeviceCommand = (command) => api.post(`${ATTENDANCE_BASE}/device/command/`, { command });
export const getCommandStatus  = () => api.get(`${ATTENDANCE_BASE}/device/command/`);

// ── Sync ─────────────────────────────────────────────────
export const syncUsers       = () => api.post(`${ATTENDANCE_BASE}/sync/users/`);
export const syncAttendance  = () => api.post(`${ATTENDANCE_BASE}/sync/attendance/`);
export const getSyncLogs     = () => api.get(`${ATTENDANCE_BASE}/sync/logs/`);

// ── Employees ────────────────────────────────────────────
export const getEmployees    = (params) => api.get(`${ATTENDANCE_BASE}/employees/`, { params });
export const toggleEmployeeActive = (id, isActive) => api.patch(`${ATTENDANCE_BASE}/employees/${id}/active/`, { is_active: isActive });
export const bulkToggleEmployeeActive = (ids, isActive) => api.patch(`${ATTENDANCE_BASE}/employees/bulk-active/`, { ids, is_active: isActive });

// ── Attendance ───────────────────────────────────────────
export const getAttendance     = (params) => api.get(`${ATTENDANCE_BASE}/attendance/`, { params });
export const getLiveAttendance = () => api.get(`${ATTENDANCE_BASE}/attendance/live/`);
export const clearAttendance   = () => api.post(`${ATTENDANCE_BASE}/attendance/clear/`);

// ── Dashboard ────────────────────────────────────────────
export const getDashboardStats = () => api.get(`${ATTENDANCE_BASE}/dashboard/stats/`);

// ── Report ───────────────────────────────────────────────
export const getAttendanceReport = (params) => api.get(`${ATTENDANCE_BASE}/report/`, { params });
export const exportAttendanceReport = (params) =>
  api.get(`${ATTENDANCE_BASE}/report/export/`, { params, responseType: 'blob' });

// ── Permissions ──────────────────────────────────────────
export const getAttendancePermissions = () => api.get(`${ATTENDANCE_BASE}/permissions/`);
export const createAttendancePermission = (data) => api.post(`${ATTENDANCE_BASE}/permissions/`, data);
export const deleteAttendancePermission = (id) => api.delete(`${ATTENDANCE_BASE}/permissions/${id}/`);

// ── My attendance info ───────────────────────────────────
export const getMyAttendanceInfo = () => api.get(`${ATTENDANCE_BASE}/my-info/`);

// ── Employee-User mapping ────────────────────────────────
export const updateEmployeeMapping = (data) => api.post(`${ATTENDANCE_BASE}/mapping/`, data);

// ── Work Shifts ──────────────────────────────────────────
export const getShifts       = () => api.get(`${ATTENDANCE_BASE}/shifts/`);
export const createShift     = (data) => api.post(`${ATTENDANCE_BASE}/shifts/`, data);
export const updateShift     = (id, data) => api.put(`${ATTENDANCE_BASE}/shifts/${id}/`, data);
export const deleteShift     = (id) => api.delete(`${ATTENDANCE_BASE}/shifts/${id}/`);
export const assignShift     = (ids, shiftId) => api.patch(`${ATTENDANCE_BASE}/employees/assign-shift/`, { ids, shift_id: shiftId });

// ── Late/Early Rules ─────────────────────────────────────
export const getLateEarlyRules   = (shiftId) => api.get(`${ATTENDANCE_BASE}/late-early-rules/`, { params: { shift_id: shiftId } });
export const saveLateEarlyRules  = (shiftId, rules) => api.post(`${ATTENDANCE_BASE}/late-early-rules/bulk/`, { shift_id: shiftId, rules });
export const deleteLateEarlyRule = (id) => api.delete(`${ATTENDANCE_BASE}/late-early-rules/${id}/`);

// ── Penalty Configs ──────────────────────────────────────
export const getPenaltyConfigs   = (shiftId) => api.get(`${ATTENDANCE_BASE}/penalty-configs/`, { params: { shift_id: shiftId } });
export const savePenaltyConfigs  = (shiftId, configs) => api.post(`${ATTENDANCE_BASE}/penalty-configs/bulk/`, { shift_id: shiftId, configs });
export const deletePenaltyConfig = (id) => api.delete(`${ATTENDANCE_BASE}/penalty-configs/${id}/`);
