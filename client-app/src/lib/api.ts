import axios, { AxiosInstance } from 'axios';

const BASE = import.meta.env.VITE_API_URL || '/api';

export const api: AxiosInstance = axios.create({ baseURL: BASE });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('condoos_token');
  if (token) {
    config.headers = config.headers || {};
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
});

// Endpoints whose 401 should be treated as "session is invalid"; for any other
// endpoint a 401 is surfaced to the caller without forcing a logout. This
// prevents a single transient 401 (e.g. from an unrelated detail-page fetch)
// from kicking the user back to /login mid-flow — the previous behaviour was
// "open a bad detail-route id → logged out".
const AUTH_INVALIDATING_PATHS = ['/auth/me', '/auth/refresh'];

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      const url: string = err?.config?.url || '';
      const invalidates = AUTH_INVALIDATING_PATHS.some((p) => url.includes(p));
      if (invalidates) {
        localStorage.removeItem('condoos_token');
        localStorage.removeItem('condoos_user');
        // Notify the auth context so React state clears and route guards
        // navigate via React Router (no full page reload).
        window.dispatchEvent(new Event('condoos:auth-invalidated'));
      }
    }
    return Promise.reject(err);
  },
);

export async function apiGet<T>(path: string): Promise<T> {
  const res = await api.get(path);
  return (res.data?.data ?? res.data) as T;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await api.post(path, body);
  return (res.data?.data ?? res.data) as T;
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await api.patch(path, body);
  return (res.data?.data ?? res.data) as T;
}

export async function apiDelete<T>(path: string, body?: unknown): Promise<T> {
  const res = await api.delete(path, body === undefined ? undefined : { data: body });
  return (res.data?.data ?? res.data) as T;
}
