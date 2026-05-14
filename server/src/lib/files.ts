import db from '../db';
import type { AuthUser } from './auth';

export const FILE_PURPOSES = [
  'document',
  'receipt',
  'ticket_attachment',
  'work_order',
  'payment_proof',
  'other',
] as const;

export const FILE_VISIBILITIES = [
  'residents',
  'board_only',
  'operations',
  'guard_only',
] as const;

export type FilePurpose = typeof FILE_PURPOSES[number];
export type FileVisibility = typeof FILE_VISIBILITIES[number];
export type FileStatus = 'pending' | 'uploaded' | 'ready' | 'deleted' | 'failed';

export interface FileRow {
  id: number;
  condominium_id: number;
  uploaded_by_user_id: number;
  original_filename: string;
  content_type: string;
  size_bytes: number;
  storage_driver: string;
  storage_key: string;
  public_url: string | null;
  purpose: FilePurpose;
  visibility: FileVisibility;
  target_type: string | null;
  target_id: number | null;
  status: FileStatus;
  created_at: string;
  uploaded_at: string | null;
  deleted_at: string | null;
}

export function fileDownloadPath(fileId: number): string {
  return `/api/uploads/files/${fileId}/download`;
}

export function cleanFilename(value: string): string {
  const cleaned = String(value || 'upload')
    .replace(/[\\/]/g, '-')
    .replace(/[^\w.\- ()]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return cleaned || 'upload';
}

export function createPendingFile(input: {
  condominiumId: number;
  uploadedByUserId: number;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  purpose: FilePurpose;
  visibility: FileVisibility;
  storageDriver: string;
  storageKey: string;
  publicUrl?: string | null;
}): FileRow {
  const result = db.prepare(
    `INSERT INTO files (
       condominium_id, uploaded_by_user_id, original_filename, content_type,
       size_bytes, storage_driver, storage_key, public_url, purpose, visibility
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.condominiumId,
    input.uploadedByUserId,
    cleanFilename(input.originalFilename),
    input.contentType,
    input.sizeBytes,
    input.storageDriver,
    input.storageKey,
    input.publicUrl || null,
    input.purpose,
    input.visibility,
  );
  return getFileById(Number(result.lastInsertRowid))!;
}

export function getFileById(fileId: number): FileRow | null {
  const row = db.prepare(`SELECT * FROM files WHERE id = ?`).get(fileId) as FileRow | undefined;
  return row || null;
}

export function markFileUploaded(fileId: number): FileRow | null {
  db.prepare(
    `UPDATE files
     SET status = CASE WHEN status = 'pending' THEN 'uploaded' ELSE status END,
         uploaded_at = COALESCE(uploaded_at, CURRENT_TIMESTAMP)
     WHERE id = ? AND status IN ('pending','uploaded')`
  ).run(fileId);
  return getFileById(fileId);
}

export function markFileReady(fileId: number): FileRow | null {
  db.prepare(
    `UPDATE files
     SET status = 'ready',
         uploaded_at = COALESCE(uploaded_at, CURRENT_TIMESTAMP)
     WHERE id = ? AND status IN ('pending','uploaded','ready')`
  ).run(fileId);
  return getFileById(fileId);
}

export function attachFileToTarget(fileId: number, targetType: string, targetId: number): FileRow | null {
  db.prepare(
    `UPDATE files
     SET target_type = ?, target_id = ?
     WHERE id = ? AND status = 'ready'`
  ).run(targetType, targetId, fileId);
  return getFileById(fileId);
}

export function softDeleteFile(fileId: number): FileRow | null {
  db.prepare(
    `UPDATE files
     SET status = 'deleted', deleted_at = COALESCE(deleted_at, CURRENT_TIMESTAMP)
     WHERE id = ? AND status <> 'deleted'`
  ).run(fileId);
  return getFileById(fileId);
}

export function assertFileReadyForUse(input: {
  fileId: number | null | undefined;
  condoId: number;
  purpose?: FilePurpose;
}): FileRow | null {
  if (!input.fileId) return null;
  const file = getFileById(input.fileId);
  if (!file) return null;
  if (file.condominium_id !== input.condoId) return null;
  if (file.status !== 'ready') return null;
  if (input.purpose && file.purpose !== input.purpose) return null;
  return file;
}

export function canAccessFile(user: AuthUser, fileId: number, condoId: number): boolean {
  const file = getFileById(fileId);
  if (!file || file.status !== 'ready' || file.condominium_id !== condoId) return false;
  if (user.role === 'board_admin') return true;
  if (file.uploaded_by_user_id === user.id) return true;
  if (user.role === 'concierge') {
    return file.visibility === 'guard_only' || file.visibility === 'residents';
  }
  return file.visibility === 'residents';
}
