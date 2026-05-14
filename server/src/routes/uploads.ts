import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { requireAuth, getActiveCondoId, AuthedRequest } from '../lib/auth';
import { ok, fail, asyncHandler } from '../lib/respond';
import { audit } from '../lib/audit';
import {
  FILE_PURPOSES,
  FILE_VISIBILITIES,
  FilePurpose,
  FileVisibility,
  attachFileToTarget,
  canAccessFile,
  cleanFilename,
  createPendingFile,
  fileDownloadPath,
  getFileById,
  markFileReady,
  markFileUploaded,
  softDeleteFile,
} from '../lib/files';

const router = Router();

const presignSchema = z.object({
  filename: z.string().min(1).max(240),
  content_type: z.string().min(3).max(160),
  size_bytes: z.number().int().positive(),
  purpose: z.enum(FILE_PURPOSES),
  visibility: z.enum(FILE_VISIBILITIES).default('board_only'),
});

const completeSchema = z.object({
  file_id: z.number().int().positive(),
  target_type: z.string().min(1).max(80).optional(),
  target_id: z.number().int().positive().optional(),
});

type StorageDriver = 'local' | 'r2';

function maxUploadBytes() {
  const mb = Number(process.env.FILE_UPLOAD_MAX_MB || process.env.UPLOAD_MAX_MB || 25);
  return Math.max(1, Math.min(100, mb)) * 1024 * 1024;
}

function r2Configured() {
  return !!(
    process.env.R2_BUCKET
    && process.env.R2_ENDPOINT
    && process.env.R2_ACCESS_KEY_ID
    && process.env.R2_SECRET_ACCESS_KEY
  );
}

function storageDriver(): StorageDriver {
  const explicit = (process.env.FILE_STORAGE_DRIVER || process.env.UPLOAD_STORAGE_DRIVER || '').toLowerCase();
  if (explicit === 'r2' || explicit === 'local') return explicit;
  return r2Configured() ? 'r2' : 'local';
}

function localUploadRoot() {
  return path.resolve(process.env.LOCAL_UPLOAD_DIR || path.join(process.cwd(), 'data', 'uploads'));
}

function localPathForKey(key: string) {
  const root = localUploadRoot();
  const resolved = path.resolve(root, key);
  if (!resolved.startsWith(root + path.sep)) {
    throw new Error('invalid_storage_key');
  }
  return resolved;
}

let cachedS3: S3Client | null = null;

function s3() {
  if (!r2Configured()) throw new Error('storage_not_configured');
  if (!cachedS3) {
    cachedS3 = new S3Client({
      region: process.env.R2_REGION || 'auto',
      endpoint: process.env.R2_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    });
  }
  return cachedS3;
}

function storageKey(condoId: number, purpose: FilePurpose, filename: string) {
  const safe = cleanFilename(filename);
  return `condos/${condoId}/${purpose}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safe}`;
}

function filePayload(fileId: number) {
  const file = getFileById(fileId);
  if (!file) return null;
  return {
    ...file,
    download_url: fileDownloadPath(file.id),
  };
}

function canCreateUpload(role: string, purpose: FilePurpose, visibility: FileVisibility): boolean {
  if (role === 'board_admin') return true;
  if (role === 'resident') {
    if (purpose === 'ticket_attachment') return visibility === 'residents' || visibility === 'board_only';
    if (purpose === 'payment_proof') return visibility === 'board_only';
  }
  if (role === 'concierge') {
    return purpose === 'other' && visibility === 'guard_only';
  }
  return false;
}

function canMutateFile(req: AuthedRequest, fileId: number, condoId: number) {
  const file = getFileById(fileId);
  if (!file || file.condominium_id !== condoId) return null;
  if (req.user!.role === 'board_admin' || file.uploaded_by_user_id === req.user!.id) return file;
  return null;
}

router.post('/presign', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = presignSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const body = parsed.data;
  if (body.size_bytes > maxUploadBytes()) return fail(res, 'file_too_large', 413);
  if (!canCreateUpload(req.user!.role, body.purpose, body.visibility)) return fail(res, 'forbidden', 403);

  const driver = storageDriver();
  if (driver === 'r2' && !r2Configured()) return fail(res, 'storage_not_configured', 503);
  const key = storageKey(condoId, body.purpose, body.filename);
  const file = createPendingFile({
    condominiumId: condoId,
    uploadedByUserId: req.user!.id,
    originalFilename: body.filename,
    contentType: body.content_type,
    sizeBytes: body.size_bytes,
    purpose: body.purpose,
    visibility: body.visibility,
    storageDriver: driver,
    storageKey: key,
  });

  const expiresIn = 10 * 60;
  if (driver === 'local') {
    audit(req, {
      action: 'file.presign',
      target_type: 'file',
      target_id: file.id,
      condominium_id: condoId,
      metadata: { driver, purpose: body.purpose, visibility: body.visibility },
    });
    return ok(res, {
      file: filePayload(file.id),
      upload_method: 'api',
      upload_url: `/api/uploads/${file.id}/content`,
      headers: { 'Content-Type': body.content_type },
      expires_in_seconds: expiresIn,
    }, 201);
  }

  const command = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET!,
    Key: key,
    ContentType: body.content_type,
    ContentLength: body.size_bytes,
  });
  const uploadUrl = await getSignedUrl(s3(), command, { expiresIn });
  audit(req, {
    action: 'file.presign',
    target_type: 'file',
    target_id: file.id,
    condominium_id: condoId,
    metadata: { driver, purpose: body.purpose, visibility: body.visibility },
  });
  return ok(res, {
    file: filePayload(file.id),
    upload_method: 'put',
    upload_url: uploadUrl,
    headers: { 'Content-Type': body.content_type },
    expires_in_seconds: expiresIn,
  }, 201);
}));

router.put('/:id/content', requireAuth, expressRawFile(), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 'invalid_id', 400);
  const file = canMutateFile(req, id, condoId);
  if (!file) return fail(res, 'not_found', 404);
  if (file.storage_driver !== 'local') return fail(res, 'wrong_upload_method', 400);
  if (file.status !== 'pending' && file.status !== 'uploaded') return fail(res, 'not_uploadable', 409);
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (body.length <= 0) return fail(res, 'empty_file', 400);
  if (body.length > maxUploadBytes() || body.length > file.size_bytes) return fail(res, 'file_too_large', 413);

  const outputPath = localPathForKey(file.storage_key);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, body);
  markFileUploaded(id);
  audit(req, {
    action: 'file.upload_local',
    target_type: 'file',
    target_id: id,
    condominium_id: condoId,
    metadata: { size_bytes: body.length },
  });
  return ok(res, { id, uploaded: true });
});

router.post('/complete', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = completeSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const file = canMutateFile(req, parsed.data.file_id, condoId);
  if (!file) return fail(res, 'not_found', 404);
  if (file.status === 'deleted') return fail(res, 'file_deleted', 409);

  if (file.storage_driver === 'local') {
    const exists = fs.existsSync(localPathForKey(file.storage_key));
    if (!exists) return fail(res, 'upload_not_found', 400);
  } else if (file.storage_driver === 'r2') {
    try {
      await s3().send(new HeadObjectCommand({
        Bucket: process.env.R2_BUCKET!,
        Key: file.storage_key,
      }));
    } catch {
      return fail(res, 'upload_not_found', 400);
    }
  }

  const ready = markFileReady(file.id);
  if (ready && parsed.data.target_type && parsed.data.target_id) {
    attachFileToTarget(ready.id, parsed.data.target_type, parsed.data.target_id);
  }
  audit(req, {
    action: 'file.complete',
    target_type: 'file',
    target_id: file.id,
    condominium_id: condoId,
    metadata: { purpose: file.purpose, target_type: parsed.data.target_type || null, target_id: parsed.data.target_id || null },
  });
  return ok(res, { file: filePayload(file.id) });
}));

router.get('/files/:id/download', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 'invalid_id', 400);
  if (!canAccessFile(req.user!, id, condoId)) return fail(res, 'not_found', 404);
  const file = getFileById(id)!;

  if (file.public_url) return res.redirect(file.public_url);

  const disposition = `inline; filename="${cleanFilename(file.original_filename).replace(/"/g, '')}"`;
  if (file.storage_driver === 'r2') {
    const url = await getSignedUrl(s3(), new GetObjectCommand({
      Bucket: process.env.R2_BUCKET!,
      Key: file.storage_key,
      ResponseContentType: file.content_type,
      ResponseContentDisposition: disposition,
    }), { expiresIn: 5 * 60 });
    return res.redirect(url);
  }

  const filePath = localPathForKey(file.storage_key);
  if (!fs.existsSync(filePath)) return fail(res, 'file_missing', 404);
  res.setHeader('Content-Type', file.content_type);
  res.setHeader('Content-Disposition', disposition);
  res.setHeader('Cache-Control', 'private, max-age=60');
  return fs.createReadStream(filePath).pipe(res);
}));

router.delete('/files/:id', requireAuth, (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 'invalid_id', 400);
  const file = canMutateFile(req, id, condoId);
  if (!file) return fail(res, 'not_found', 404);
  softDeleteFile(id);
  audit(req, {
    action: 'file.delete',
    target_type: 'file',
    target_id: id,
    condominium_id: condoId,
    metadata: { soft_delete: true },
  });
  return ok(res, { id, deleted: true });
});

function expressRawFile() {
  const express = require('express') as typeof import('express');
  return express.raw({
    type: '*/*',
    limit: `${Math.ceil(maxUploadBytes() / (1024 * 1024))}mb`,
  });
}

export default router;
