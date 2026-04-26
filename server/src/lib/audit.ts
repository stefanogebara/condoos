import { Request } from 'express';
import db from '../db';
import { AuthedRequest } from './auth';

export interface AuditInput {
  action: string;
  target_type?: string;
  target_id?: number | null;
  metadata?: unknown;
  condominium_id?: number | null;
}

export interface AuditFilter {
  condominium_id: number;
  action?: string;
  target_type?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export interface AuditRow {
  id: number;
  condominium_id: number | null;
  actor_user_id: number | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: number | null;
  metadata: string | null;
  ip: string | null;
  created_at: string;
}

function requestIp(req: Request): string | null {
  return req.ip || req.socket.remoteAddress || null;
}

export function audit(req: AuthedRequest, input: AuditInput): number {
  const metadata = input.metadata === undefined ? null : JSON.stringify(input.metadata);
  const result = db.prepare(
    `INSERT INTO audit_log (
       condominium_id, actor_user_id, actor_email, action,
       target_type, target_id, metadata, ip
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.condominium_id ?? req.user?.condominium_id ?? null,
    req.user?.id ?? null,
    req.user?.email ?? null,
    input.action,
    input.target_type || null,
    input.target_id ?? null,
    metadata,
    requestIp(req),
  );
  return Number(result.lastInsertRowid);
}

export function listAuditRows(filter: AuditFilter): AuditRow[] {
  const clauses = ['condominium_id = ?'];
  const params: any[] = [filter.condominium_id];

  if (filter.action) {
    clauses.push('action = ?');
    params.push(filter.action);
  }
  if (filter.target_type) {
    clauses.push('target_type = ?');
    params.push(filter.target_type);
  }
  if (filter.from) {
    clauses.push('created_at >= ?');
    params.push(filter.from);
  }
  if (filter.to) {
    clauses.push('created_at <= ?');
    params.push(filter.to);
  }

  const limit = Math.max(1, Math.min(500, filter.limit || 100));
  params.push(limit);
  return db.prepare(
    `SELECT *
     FROM audit_log
     WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC, id DESC
     LIMIT ?`
  ).all(...params) as AuditRow[];
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function auditRowsToCsv(rows: AuditRow[]): string {
  const headers = [
    'id',
    'created_at',
    'condominium_id',
    'actor_user_id',
    'actor_email',
    'action',
    'target_type',
    'target_id',
    'metadata',
    'ip',
  ];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvCell((row as any)[header])).join(','));
  }
  return `${lines.join('\n')}\n`;
}
