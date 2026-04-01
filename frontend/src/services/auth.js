import { jwtDecode } from 'jwt-decode';

function decodeAccessToken() {
  const token = localStorage.getItem('access_token');
  if (!token) return null;

  try {
    return jwtDecode(token);
  } catch {
    return null;
  }
}

export function getCurrentUserRoles() {
  try {
    const userRaw = localStorage.getItem('user');
    if (userRaw) {
      const user = JSON.parse(userRaw);
      if (Array.isArray(user?.roles)) return user.roles.map((role) => String(role).toLowerCase());
    }
  } catch {
    // Ignore invalid local storage payload.
  }

  const payload = decodeAccessToken();
  if (Array.isArray(payload?.roles)) {
    return payload.roles.map((role) => String(role).toLowerCase());
  }

  return [];
}

export function hasCurrentUserRole(roleName) {
  return getCurrentUserRoles().includes(String(roleName).toLowerCase());
}

export function getCurrentUserPermissions() {
  try {
    const userRaw = localStorage.getItem('user');
    if (userRaw) {
      const user = JSON.parse(userRaw);
      if (Array.isArray(user?.permissions)) {
        return user.permissions.map((permission) => String(permission));
      }
    }
  } catch {
    // Ignore invalid local storage payload.
  }

  return [];
}

export function getCurrentUserId() {
  try {
    const userRaw = localStorage.getItem('user');
    if (userRaw) {
      const user = JSON.parse(userRaw);
      if (user?.id) return Number(user.id);
    }
  } catch {
    // Ignore invalid local storage payload.
  }

  const payload = decodeAccessToken();
  const userId = payload?.user_id || payload?.id;
  return userId ? Number(userId) : null;
}
