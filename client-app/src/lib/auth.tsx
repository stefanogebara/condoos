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
  login: (email: string, password: string) => Promise<User>;
  loginWithGoogle: (credential: string) => Promise<User>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>({
  user: null, loading: true,
  login: async () => { throw new Error('not ready'); },
  loginWithGoogle: async () => { throw new Error('not ready'); },
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const raw = localStorage.getItem('condoos_user');
    const token = localStorage.getItem('condoos_token');
    if (raw && token) {
      setUser(JSON.parse(raw));
      apiGet<{ user: User }>('/auth/me')
        .then((d) => { setUser(d.user); localStorage.setItem('condoos_user', JSON.stringify(d.user)); })
        .catch(() => {})
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const completeLogin = (data: { token: string; user: User }, source: 'password' | 'google'): User => {
    localStorage.setItem('condoos_token', data.token);
    localStorage.setItem('condoos_user', JSON.stringify(data.user));
    setUser(data.user);
    identify({ id: data.user.id, email: data.user.email, role: data.user.role, condominium_id: data.user.condominium_id });
    track('signup_completed', { source, role: data.user.role, has_condo: data.user.condominium_id != null });
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
    reset();
    window.location.href = '/login';
  };

  return (
    <Ctx.Provider value={{ user, loading, login, loginWithGoogle, logout }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  return useContext(Ctx);
}
