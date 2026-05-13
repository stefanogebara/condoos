import { Router } from 'express';
import { z } from 'zod';
import db from '../db';
import { requireAuth, requireRole, getActiveCondoId, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';
import { audit } from '../lib/audit';

const router = Router();

const DOCUMENT_CATEGORIES = [
  'rules',
  'minutes',
  'contracts',
  'insurance',
  'warranties',
  'receipts',
  'vendors',
  'notices',
  'other',
] as const;

const DOCUMENT_VISIBILITIES = ['residents', 'board_only'] as const;

const documentSchema = z.object({
  title: z.string().min(1).max(160),
  category: z.enum(DOCUMENT_CATEGORIES),
  description: z.string().max(1_000).optional().nullable(),
  file_url: z.string().url().max(2_048).refine((url) => url.startsWith('https://'), {
    message: 'must_be_https_url',
  }),
  document_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  visibility: z.enum(DOCUMENT_VISIBILITIES).default('residents'),
  active: z.boolean().optional().default(true),
});

function cleanText(value: string | null | undefined) {
  const trimmed = String(value || '').trim();
  return trimmed || null;
}

router.get('/', requireAuth, (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const isAdmin = req.user?.role === 'board_admin';
  const includeInactive = isAdmin && (req.query.include_inactive === '1' || req.query.include_inactive === 'true');
  const category = typeof req.query.category === 'string' && DOCUMENT_CATEGORIES.includes(req.query.category as any)
    ? req.query.category
    : null;

  const conditions = ['d.condominium_id = ?'];
  const params: Array<string | number> = [condoId];

  if (!includeInactive) conditions.push('d.active = 1');
  if (!isAdmin) conditions.push(`d.visibility = 'residents'`);
  if (category) {
    conditions.push('d.category = ?');
    params.push(category);
  }

  const rows = db.prepare(
    `SELECT d.*,
            TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS uploaded_by_name
     FROM building_documents d
     LEFT JOIN users u ON u.id = d.uploaded_by_user_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY
       CASE WHEN d.document_date IS NULL OR d.document_date = '' THEN 1 ELSE 0 END,
       d.document_date DESC,
       d.updated_at DESC,
       d.created_at DESC`
  ).all(...params);

  return ok(res, rows);
});

router.post('/', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const parsed = documentSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());

  const condoId = getActiveCondoId(req);
  const body = parsed.data;
  const result = db.prepare(
    `INSERT INTO building_documents (
      condominium_id, uploaded_by_user_id, title, category, description,
      file_url, document_date, visibility, active
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    condoId,
    req.user!.id,
    body.title.trim(),
    body.category,
    cleanText(body.description),
    body.file_url.trim(),
    body.document_date || null,
    body.visibility,
    body.active ? 1 : 0,
  );

  const id = Number(result.lastInsertRowid);
  audit(req, {
    action: 'document.create',
    target_type: 'building_document',
    target_id: id,
    condominium_id: condoId,
    metadata: { category: body.category, visibility: body.visibility },
  });

  return ok(res, { id }, 201);
});

router.patch('/:id', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const parsed = documentSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());

  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 'invalid_id', 400);

  const existing = db.prepare(
    `SELECT id FROM building_documents WHERE id = ? AND condominium_id = ?`
  ).get(id, condoId);
  if (!existing) return fail(res, 'not_found', 404);

  const body = parsed.data;
  db.prepare(
    `UPDATE building_documents
     SET title = ?, category = ?, description = ?, file_url = ?, document_date = ?,
         visibility = ?, active = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND condominium_id = ?`
  ).run(
    body.title.trim(),
    body.category,
    cleanText(body.description),
    body.file_url.trim(),
    body.document_date || null,
    body.visibility,
    body.active ? 1 : 0,
    id,
    condoId,
  );

  audit(req, {
    action: 'document.update',
    target_type: 'building_document',
    target_id: id,
    condominium_id: condoId,
    metadata: { category: body.category, visibility: body.visibility, active: body.active },
  });

  return ok(res, { id });
});

router.delete('/:id', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 'invalid_id', 400);

  const existing = db.prepare(
    `SELECT id FROM building_documents WHERE id = ? AND condominium_id = ?`
  ).get(id, condoId);
  if (!existing) return fail(res, 'not_found', 404);

  db.prepare(
    `UPDATE building_documents
     SET active = 0, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND condominium_id = ?`
  ).run(id, condoId);

  audit(req, {
    action: 'document.deactivate',
    target_type: 'building_document',
    target_id: id,
    condominium_id: condoId,
  });

  return ok(res, { id });
});

export default router;
