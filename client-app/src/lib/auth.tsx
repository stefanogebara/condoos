import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { apiPost, apiGet } from './api';
import { identify, reset, track } from './analytics';

export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: 'resident' | 'board_admin';
  condominium_id: number | null;
  unit_number: string | null;
  avatar_url: string | null;
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  membershipStatus: 'unknown' | 'checking' | 'active' | 'none';
  hasActiveMembership: boolean | null;
  login: (email: string, password: string) => Promise<User>;
  loginWithGoogle: (credential: string) => Promise<User>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>({
  user: null, loading: true, membershipStatus: 'unknown', hasActiveMembership: null,
  login: async () => { throw new Error('not ready'); },
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
    const raw = localStorage.getItem('condoos_user');
    const token = localStorage.getItem('condoos_token');
    if (raw && token) {
      setUser(JSON.parse(raw));
      apiGet<{ user: User }>('/auth/me')
        .then(async (d) => {
          setUser(d.user);
          localStorage.setItem('condoos_user', JSON.stringify(d.user));
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

  const completeLogin = async (data: { token: string; user: User }, source: 'password' | 'google'): Promise<User> => {
    localStorage.setItem('condoos_token', data.token);
    localStorage.setItem('condoos_user', JSON.stringify(data.user));
    setUser(data.user);
    identify({ id: data.user.id, email: data.user.email, role: data.user.role, condominium_id: data.user.condominium_id });
    track('signup_completed', { source, role: data.user.role, has_condo: data.user.condominium_id != null });
    await refreshMembershipStatus();
    return data.user;
  };

  const login = async (email: string, password: string): Promise<User> => {
    const data = await apiPost<{ token: string; user: User }>('/auth/login', { email, password });
    return completeLogin(data, 'password');
  };

  const loginWithGoogle = async (credential: string): Promise<User> => {
    const data = await apiPost<{ token: string; user: User }>('/auth/google', { credential });
    return completeLogin(data, 'google');
  };

  const logout = () => {
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
    <Ctx.Provider value={{ user, loading, membershipStatus, hasActiveMembership, login, loginWithGoogle, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}
