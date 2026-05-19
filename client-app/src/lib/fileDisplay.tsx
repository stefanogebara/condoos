// Phase 3 polish — small helpers for the document vault display so
// the board + resident pages share one source of truth for "what icon
// goes with this file" and "how to format a byte count".
//
// External-link rows (no file_id) get a generic FolderOpen icon since
// we don't know the underlying content type. Uploaded rows get a
// specific icon based on file_content_type from the API response.

import React from 'react';
import {
  FileText,
  FileImage,
  FileSpreadsheet,
  FileArchive,
  FileVideo,
  FileAudio,
  FolderOpen,
  type LucideIcon,
} from 'lucide-react';

// Map a MIME type to a Lucide icon. Errs on the side of FileText for
// "I have a file but I don't recognize the MIME" so the row still
// renders sensibly. Order matters: more-specific MIME prefixes first.
export function fileIconFor(contentType: string | null | undefined): LucideIcon {
  const ct = String(contentType || '').toLowerCase();
  if (!ct) return FolderOpen;
  if (ct.startsWith('image/')) return FileImage;
  if (ct === 'application/pdf') return FileText;
  if (ct.includes('spreadsheet') || ct.includes('excel') || ct.includes('csv')) return FileSpreadsheet;
  if (ct.includes('zip') || ct.includes('rar') || ct.includes('tar') || ct.includes('7z')) return FileArchive;
  if (ct.startsWith('video/')) return FileVideo;
  if (ct.startsWith('audio/')) return FileAudio;
  if (ct.includes('msword') || ct.includes('officedocument') || ct.startsWith('text/')) return FileText;
  return FileText;
}

// Pick an icon for the document row. file_id present → derive from
// content type; no file_id (external link) → folder.
export function documentIconFor(doc: { file_id: number | null; file_content_type?: string | null }): LucideIcon {
  if (!doc.file_id) return FolderOpen;
  return fileIconFor(doc.file_content_type);
}

// Human-readable byte count. Returns null when bytes is null/missing
// so the caller can skip rendering instead of showing "—" or "0 B".
// SI units (1000-based) because that's what most "X MB" estimates
// users have seen on cloud storage UIs.
export function formatFileSize(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  // 1 decimal for KB+, integer for plain bytes (a 743-byte file
  // shouldn't read "743.0 B").
  const formatted = unit === 0 ? Math.round(value).toString() : value.toFixed(value >= 100 ? 0 : 1);
  return `${formatted} ${units[unit]}`;
}
