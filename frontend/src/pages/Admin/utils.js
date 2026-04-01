export function normalizeList(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.results)) return payload.results;
  return [];
}

export function formatRoleLabel(role) {
  if (!role) return '-';
  return String(role).toUpperCase();
}

export function formatRoleDisplayName(role) {
  const normalized = String(role || '').toLowerCase();
  if (normalized === 'admin') return 'Quản trị viên';
  if (normalized === 'manager') return 'Quản lý';
  if (normalized === 'staff') return 'Nhân viên';
  return normalized ? normalized.toUpperCase() : '-';
}

export function formatBooleanStatus(value) {
  return value ? 'Đang hoạt động' : 'Đã khóa';
}
