import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole, getActiveCondoId, AuthedRequest } from '../lib/auth';
import { ok, fail } from '../lib/respond';
import { auditRowsToCsv, listAuditRows } from '../lib/audit';

const router = Router();

const auditQuerySchema = z.object({
  action: z.string().min(1).max(120).optional(),
  target_type: z.string().min(1).max(80).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

function parseQuery(req: AuthedRequest) {
  const parsed = auditQuerySchema.safeParse(req.query);
  if (!parsed.success) return { ok: false as const, error: parsed.error.flatten() };
  return { ok: true as const, data: parsed.data };
}

router.get('/', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const parsed = parseQuery(req);
  if (!parsed.ok) return fail(res, 'invalid_input', 400, parsed.error);
  const rows = listAuditRows({
    condominium_id: getActiveCondoId(req),
    ...parsed.data,
  });
  return ok(res, rows);
});

router.get('/export', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const parsed = parseQuery(req);
  if (!parsed.ok) return fail(res, 'invalid_input', 400, parsed.error);
  const rows = listAuditRows({
    condominium_id: getActiveCondoId(req),
    ...parsed.data,
    limit: parsed.data.limit || 500,
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="condoos-audit.csv"');
  return res.status(200).send(auditRowsToCsv(rows));
});

export default router;
