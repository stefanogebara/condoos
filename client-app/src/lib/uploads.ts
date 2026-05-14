import { api, apiPost } from './api';

export type UploadPurpose = 'document' | 'receipt' | 'ticket_attachment' | 'work_order' | 'payment_proof' | 'other';
export type UploadVisibility = 'residents' | 'board_only' | 'operations' | 'guard_only';

export interface UploadedFile {
  id: number;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  purpose: UploadPurpose;
  visibility: UploadVisibility;
  download_url: string;
}

interface PresignResponse {
  file: UploadedFile;
  upload_method: 'api' | 'put';
  upload_url: string;
  headers: Record<string, string>;
}

function resolveUploadUrl(uploadUrl: string) {
  if (/^https?:\/\//i.test(uploadUrl)) return uploadUrl;
  const base = String(api.defaults.baseURL || '/api');
  if (/^https?:\/\//i.test(base)) {
    return `${base.replace(/\/api\/?$/, '')}${uploadUrl}`;
  }
  return uploadUrl;
}

export async function uploadFileToCondoOS(file: File, opts: {
  purpose: UploadPurpose;
  visibility: UploadVisibility;
}): Promise<UploadedFile> {
  const presign = await apiPost<PresignResponse>('/uploads/presign', {
    filename: file.name,
    content_type: file.type || 'application/octet-stream',
    size_bytes: file.size,
    purpose: opts.purpose,
    visibility: opts.visibility,
  });

  const headers = { ...(presign.headers || {}) };
  if (presign.upload_method === 'api') {
    const token = localStorage.getItem('condoos_token');
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const uploadRes = await fetch(resolveUploadUrl(presign.upload_url), {
    method: 'PUT',
    headers,
    body: file,
  });
  if (!uploadRes.ok) {
    throw new Error(`upload_failed_${uploadRes.status}`);
  }

  const completed = await apiPost<{ file: UploadedFile }>('/uploads/complete', {
    file_id: presign.file.id,
  });
  return completed.file;
}

export async function openUploadedFile(fileId: number, filename?: string | null) {
  const response = await api.get(`/uploads/files/${fileId}/download`, { responseType: 'blob' });
  const blob = response.data as Blob;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  if (filename) link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
