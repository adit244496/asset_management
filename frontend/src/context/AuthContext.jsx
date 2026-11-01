import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api, { TOKEN_KEY } from '../api';
import * as roles from '../lib/roles';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [bootstrapping, setBootstrapping] = useState(() => {
    try { return !!localStorage.getItem(TOKEN_KEY); } catch { return false; }
  });

  useEffect(() => {
    let cancelled = false;
    const token = (() => {
      try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
    })();

    if (!token) return undefined;

    api.get('/auth/me')
      .then((res) => { if (!cancelled) setUser(res.data); })
      .catch(() => {
        try { localStorage.removeItem(TOKEN_KEY); } catch {  }
        if (!cancelled) setUser(null);
      })
      .finally(() => { if (!cancelled) setBootstrapping(false); });

    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener('iam:unauthorized', onUnauthorized);
    return () => window.removeEventListener('iam:unauthorized', onUnauthorized);
  }, []);

  const setSession = useCallback((accessToken, loggedIn) => {
    try { localStorage.setItem(TOKEN_KEY, accessToken); } catch {  }
    setUser(loggedIn);
  }, []);

  const login = useCallback(async (username, password) => {
    const res = await api.post('/auth/login', { username, password });
    const { accessToken, user: loggedIn } = res.data;
    try { localStorage.setItem(TOKEN_KEY, accessToken); } catch {  }
    setUser(loggedIn);
    return loggedIn;
  }, []);

  const logout = useCallback(() => {
    try { localStorage.removeItem(TOKEN_KEY); } catch {  }
    setUser(null);
  }, []);

  const changePassword = useCallback(async (currentPassword, newPassword) => {
    const res = await api.patch('/auth/me/password', { currentPassword, newPassword });
    setUser((prev) => (prev ? { ...prev, mustChangePassword: false } : prev));
    return res.data;
  }, []);

  const value = useMemo(() => ({
    user,
    bootstrapping,
    isAuthenticated: !!user,
    role: user?.role || null,
    isAdmin: roles.isAdmin(user?.role),
    isSuperadmin: roles.isSuperadmin(user?.role),
    canWrite: roles.canWrite(user?.role),
    canVerify: roles.canVerify(user?.role),
    canDiscard: roles.canDiscard(user?.role),
    canEdit: roles.canEdit(user?.role),
    mustChangePassword: Boolean(user?.mustChangePassword),
    setSession,
    login,
    logout,
    changePassword,
  }), [user, bootstrapping, setSession, login, logout, changePassword]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside an AuthProvider');
  return ctx;
}
