import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api, apiPost, apiGet } from './api';
import { identify, reset, track } from './analytics';

// Read a JSON-encoded value from localStorage. If the key holds the literal
// string "undefined" or any non-JSON garbage, wipe it and return null instead
// of throwing — a stale "undefined" payload used to crash the entire app on
// reload (SyntaxError: "undefined" is not valid JSON).
function safeReadJson<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  if (!raw || raw === 'undefined' || raw === 'null') {
    if (raw) localStorage.removeItem(key);
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

// Persist a value as JSON, but never write a literal "undefined" / "null"
// string — drop the key instead, so the next read short-circuits cleanly.
function safeWriteJson(key: string, value: unknown): void {
  if (value == null) {
    localStorage.removeItem(key);
    return;
  }
  localStorage.setItem(key, JSON.stringify(value));
}

export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: 'resident' | 'board_admin' | 'concierge';
  condominium_id: number | null;
  unit_number: string | null;
  avatar_url: string | null;
  mobile_phone?: string | null;
  home_phone?: string | null;
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  membershipStatus: 'unknown' | 'checking' | 'active' | 'none';
  hasActiveMembership: boolean | null;
  login: (email: string, password: string) => Promise<User>;
  register: (input: { email: string; password: string; first_name: string; last_name: string }) => Promise<User>;
  loginWithGoogle: (credential: string) => Promise<User>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>({
  user: null, loading: true, membershipStatus: 'unknown', hasActiveMembership: null,
  login: async () => { throw new Error('not ready'); },
  register: async () => { throw new Error('not ready'); },
  loginWithGoogle: async () => { throw new Error('not ready'); },
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [membershipStatus, setMembershipStatus] = useState<AuthCtx['membershipStatus']>('unknown');

  async function refreshMembershipStatus(): Promise<boolean> {
    setMembershipStatus('checking');
    try {
      const rows = await apiGet<Array<{ status: string }>>('/onboarding/me');
      const hasActive = rows.some((m) => m.status === 'active');
      setMembershipStatus(hasActive ? 'active' : 'none');
      return hasActive;
    } catch {
      setMembershipStatus('none');
      return false;
    }
  }

  useEffect(() => {
    const cached = safeReadJson<User>('condoos_user');
    const token = localStorage.getItem('condoos_token');
    if (cached && token) {
      setUser(cached);
      apiGet<{ user: User }>('/auth/me')
        .then(async (d) => {
          setUser(d.user);
          safeWriteJson('condoos_user', d.user);
          await refreshMembershipStatus();
        })
        .catch(() => {
          setUser(null);
          setMembershipStatus('unknown');
        })
        .finally(() => setLoading(false));
    } else {
      setMembershipStatus('unknown');
      setLoading(false);
    }
  }, []);

  // The api interceptor dispatches this event when an auth endpoint (/auth/me,
  // /auth/refresh) returns 401. Clear React state so route guards in App.tsx
  // redirect to /login on the next render — replaces the previous full-page
  // window.location.href = '/login' which interrupted unrelated UI work.
  useEffect(() => {
    function onInvalidated() {
      setUser(null);
      setMembershipStatus('unknown');
    }
    window.addEventListener('condoos:auth-invalidated', onInvalidated);
    return () => window.removeEventListener('condoos:auth-invalidated', onInvalidated);
  }, []);

  const completeLogin = async (data: { token: string; user: User }, source: 'password' | 'google'): Promise<User> => {
    localStorage.setItem('condoos_token', data.token);
    safeWriteJson('condoos_user', data.user);
    setUser(data.user);
    const hasActiveMembership = await refreshMembershipStatus();
    identify({ id: data.user.id, role: data.user.role, has_condo: hasActiveMembership });
    track('login_completed', { source, role: data.user.role, has_active_membership: hasActiveMembership });
    return data.user;
  };

  const login = async (email: string, password: string): Promise<User> => {
    const data = await apiPost<{ token: string; user: User }>('/auth/login', { email, password });
    return completeLogin(data, 'password');
  };

  const register = async (input: { email: string; password: string; first_name: string; last_name: string }): Promise<User> => {
    const data = await apiPost<{ token: string; user: User }>('/auth/register', input);
    return completeLogin(data, 'password');
  };

  const loginWithGoogle = async (credential: string): Promise<User> => {
    const data = await apiPost<{ token: string; user: User }>('/auth/google', { credential });
    return completeLogin(data, 'google');
  };

  const logout = () => {
    const token = localStorage.getItem('condoos_token');
    if (token) {
      void api.delete('/auth/logout', {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    localStorage.removeItem('condoos_token');
    localStorage.removeItem('condoos_user');
    setUser(null);
    setMembershipStatus('unknown');
    reset();
    window.location.href = '/login';
  };

  const hasActiveMembership = membershipStatus === 'active'
    ? true
    : membershipStatus === 'none'
      ? false
      : null;

  return (
    <Ctx.Provider value={{ user, loading, membershipStatus, hasActiveMembership, login, register, loginWithGoogle, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}
