#!/usr/bin/env node

import { randomUUID } from 'node:crypto';

const DEFAULT_API_URL = 'https://condoos-api.fly.dev/api';
const DEFAULT_EMAIL = 'admin@condoos.dev';
const DEFAULT_PASSWORD = 'admin123';

function argValue(name) {
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return null;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

const apiURL = (argValue('--api-url') || process.env.PROD_API_URL || process.env.E2E_API_URL || DEFAULT_API_URL)
  .replace(/\/+$/, '');
const email = argValue('--email') || process.env.PROD_UPLOAD_EMAIL || process.env.PROD_ADMIN_EMAIL || DEFAULT_EMAIL;
const password = argValue('--password') || process.env.PROD_UPLOAD_PASSWORD || process.env.PROD_ADMIN_PASSWORD || DEFAULT_PASSWORD;
const requireR2 = hasFlag('--require-r2') || !hasFlag('--allow-local');

function apiOrigin() {
  return apiURL.replace(/\/api\/?$/, '');
}

function resolveUploadUrl(uploadUrl) {
  if (/^https?:\/\//i.test(uploadUrl)) return uploadUrl;
  return `${apiOrigin()}${uploadUrl}`;
}

async function jsonRequest(path, init = {}) {
  const res = await fetch(`${apiURL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'CondoOS-prod-upload-check/1.0',
      ...(init.headers || {}),
    },
  });
  const raw = await res.text();
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`${path} returned non-JSON (${res.status}): ${raw.slice(0, 200)}`);
  }
  if (!res.ok) {
    const code = body?.error || body?.message || raw.slice(0, 120);
    throw new Error(`${path} returned ${res.status}: ${code}`);
  }
  return body?.data ?? body;
}

async function downloadFile(path, token) {
  const first = await fetch(`${apiURL.replace(/\/+$/, '')}${path.replace(/^\/api/, '')}`, {
    redirect: 'manual',
    headers: {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'CondoOS-prod-upload-check/1.0',
    },
  });

  if (first.status >= 300 && first.status < 400) {
    const location = first.headers.get('location');
    if (!location) throw new Error(`download redirect ${first.status} missing location`);
    const signed = await fetch(location, {
      headers: { 'User-Agent': 'CondoOS-prod-upload-check/1.0' },
    });
    if (!signed.ok) throw new Error(`signed download returned ${signed.status}`);
    return Buffer.from(await signed.arrayBuffer());
  }

  if (!first.ok) throw new Error(`download returned ${first.status}`);
  return Buffer.from(await first.arrayBuffer());
}

async function main() {
  let fileId = null;
  let token = null;

  try {
    const session = await jsonRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    token = session.token;
    if (!token) throw new Error('login response did not include a token');

    const content = Buffer.from(`CondoOS production upload check ${new Date().toISOString()} ${randomUUID()}\n`, 'utf8');
    const filename = `condoos-upload-check-${Date.now()}.txt`;
    const presign = await jsonRequest('/uploads/presign', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        filename,
        content_type: 'text/plain',
        size_bytes: content.length,
        purpose: 'document',
        visibility: 'board_only',
      }),
    });

    fileId = presign?.file?.id;
    const storageDriver = presign?.file?.storage_driver || null;
    if (requireR2 && presign.upload_method !== 'put') {
      throw new Error(`production upload is not using R2: upload_method=${presign.upload_method}, storage_driver=${storageDriver}`);
    }

    const uploadHeaders = { ...(presign.headers || {}) };
    if (presign.upload_method === 'api') uploadHeaders.Authorization = `Bearer ${token}`;
    const uploaded = await fetch(resolveUploadUrl(presign.upload_url), {
      method: 'PUT',
      headers: uploadHeaders,
      body: content,
    });
    if (!uploaded.ok) throw new Error(`upload returned ${uploaded.status}`);

    const completed = await jsonRequest('/uploads/complete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ file_id: fileId }),
    });
    const file = completed.file;
    if (!file || file.status !== 'ready') throw new Error(`file did not become ready: ${JSON.stringify(file || {})}`);

    const downloaded = await downloadFile(file.download_url, token);
    if (!downloaded.equals(content)) {
      throw new Error(`downloaded bytes mismatch: expected ${content.length}, got ${downloaded.length}`);
    }

    await jsonRequest(`/uploads/files/${fileId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    fileId = null;

    console.log(JSON.stringify({
      ok: true,
      api_url: apiURL,
      require_r2: requireR2,
      upload_method: presign.upload_method,
      storage_driver: storageDriver,
      bytes_verified: content.length,
    }, null, 2));
  } finally {
    if (fileId && token) {
      await jsonRequest(`/uploads/files/${fileId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  }
}

main().catch((err) => {
  console.error(JSON.stringify({
    ok: false,
    api_url: apiURL,
    require_r2: requireR2,
    error: err instanceof Error ? err.message : String(err),
  }, null, 2));
  process.exit(1);
});
