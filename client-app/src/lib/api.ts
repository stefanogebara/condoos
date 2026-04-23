import axios, { AxiosInstance } from 'axios';

const BASE = process.env.REACT_APP_API_URL || '/api';

export const api: AxiosInstance = axios.create({ baseURL: BASE });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('condoos_token');
  if (token) {
    config.headers = config.headers || {};
    (config.headers as any).Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      localStorage.removeItem('condoos_token');
      localStorage.removeItem('condoos_user');
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
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

export async function apiDelete<T>(path: string): Promise<T> {
  const res = await api.delete(path);
  return (res.data?.data ?? res.data) as T;
}
