import { createContext, useContext, useMemo, useState } from 'react';
import { jwtDecode } from 'jwt-decode';

const AuthContext = createContext(null);

function safeParseUser() {
  try {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function decodeToken(token) {
  if (!token) return null;
  try {
    return jwtDecode(token);
  } catch {
    return null;
  }
}

function isTokenExpired(payload) {
  if (!payload?.exp) return true;
  const nowInSeconds = Math.floor(Date.now() / 1000);
  return payload.exp <= nowInSeconds;
}

function buildUserFromToken(tokenPayload, fallbackUser) {
  if (!tokenPayload && !fallbackUser) return null;

  const roles = Array.isArray(tokenPayload?.roles)
    ? tokenPayload.roles
    : Array.isArray(fallbackUser?.roles)
      ? fallbackUser.roles
      : [];

  return {
    id: tokenPayload?.user_id ?? fallbackUser?.id ?? null,
    username: fallbackUser?.username ?? tokenPayload?.username ?? '',
    roles,
    full_name: fallbackUser?.full_name ?? '',
    first_name: fallbackUser?.first_name ?? '',
    last_name: fallbackUser?.last_name ?? '',
    email: fallbackUser?.email ?? '',
    permissions: fallbackUser?.permissions ?? [],
  };
}

function getInitialAuthState() {
  const accessToken = localStorage.getItem('access_token');
  const refreshToken = localStorage.getItem('refresh_token');

  if (!accessToken || !refreshToken) {
    return { user: null, isAuthenticated: false };
  }

  const payload = decodeToken(accessToken);
  if (!payload || isTokenExpired(payload)) {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    return { user: null, isAuthenticated: false };
  }

  const localUser = safeParseUser();
  const user = buildUserFromToken(payload, localUser);
  if (user) {
    localStorage.setItem('user', JSON.stringify(user));
  }

  return {
    user,
    isAuthenticated: true,
  };
}

export function AuthProvider({ children }) {
  const [authState, setAuthState] = useState(getInitialAuthState);

  const login = ({ access, refresh, user }) => {
    localStorage.setItem('access_token', access);
    localStorage.setItem('refresh_token', refresh);

    const payload = decodeToken(access);
    const normalizedUser = buildUserFromToken(payload, user);
    if (normalizedUser) {
      localStorage.setItem('user', JSON.stringify(normalizedUser));
    }

    setAuthState({
      user: normalizedUser,
      isAuthenticated: true,
    });
  };

  const logout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('user');
    setAuthState({ user: null, isAuthenticated: false });
  };

  const value = useMemo(
    () => ({
      user: authState.user,
      isAuthenticated: authState.isAuthenticated,
      login,
      logout,
    }),
    [authState],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider.');
  }
  return context;
}
