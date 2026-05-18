// Admin-only operational endpoints. Currently just backup status + a
// manual trigger; future home for "snapshot now before risky migration",
// "rebuild scorecards", etc.
import { Router } from 'express';
import { z } from 'zod';
import db from '../db';
import { requireAuth, requireRole, AuthedRequest } from '../lib/auth';
import { ok, fail, asyncHandler } from '../lib/respond';
import { createRateLimit } from '../lib/rate-limit';
import { audit } from '../lib/audit';
import { runBackup, getBackupStatus, backupConfigured } from '../lib/backup';

const router = Router();

// Cap manual backup runs at 3/hour per admin. Each backup is a full
// snapshot + upload — bounded but not free. Rate-limit prevents a
// runaway dashboard from racking up S3 PUTs.
const backupRateLimit = createRateLimit({
  keyPrefix: 'admin-backup',
  windowMs: 60 * 60_000,
  max: 3,
  key: (req) => String((req as AuthedRequest).user?.id || req.ip || 'unknown'),
});

router.get('/backup/status', requireAuth, requireRole('board_admin'), (_req: AuthedRequest, res) => {
  return ok(res, getBackupStatus());
});

router.post('/backup/run', requireAuth, requireRole('board_admin'), backupRateLimit, asyncHandler(async (req: AuthedRequest, res) => {
  if (!backupConfigured()) return fail(res, 'backup_not_configured', 503);
  const result = await runBackup();
  audit(req, {
    action: 'admin.backup_run',
    target_type: 'backup',
    target_id: 0,
    condominium_id: req.user?.condominium_id ?? null,
    metadata: { ok: result.ok, key: result.key, size_bytes: result.size_bytes, error: result.error },
  });
  if (!result.ok) return fail(res, result.error || 'backup_failed', 500, result);
  return ok(res, result);
}));

// ARC-R5 — Per-condo agent kill switch. Board admins can pause /
// resume automatic dispatch without a redeploy. The agent itself
// keeps running (workbench drafts still work); only the auto-WhatsApp
// fire is gated. Every flip is audit-logged.
//
// PROD-WARN-3 (re-audit) — rate-limit the PATCH so a compromised
// admin token can't spam the audit log with thousands of flips per
// minute. 10/min is generous for legitimate use (a panicked ops flip
// + re-flip is at most a handful of calls); enough to stop log
// flooding without blocking real toggles.
const killSwitchRateLimit = createRateLimit({
  keyPrefix: 'admin-killswitch',
  windowMs: 60_000,
  max: 10,
  key: (req) => String((req as AuthedRequest).user?.id || req.ip || 'unknown'),
});

router.get('/agent/kill-switch', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = req.user?.condominium_id;
  if (!condoId) return fail(res, 'no_active_condo', 400);
  const row = db.prepare(
    `SELECT auto_dispatch_enabled FROM condominiums WHERE id = ?`
  ).get(condoId) as { auto_dispatch_enabled: number | null } | undefined;
  return ok(res, {
    auto_dispatch_enabled: !!(row?.auto_dispatch_enabled),
  });
});

const killSwitchSchema = z.object({
  auto_dispatch_enabled: z.boolean(),
});

router.patch('/agent/kill-switch', requireAuth, requireRole('board_admin'), killSwitchRateLimit, (req: AuthedRequest, res) => {
  const condoId = req.user?.condominium_id;
  if (!condoId) return fail(res, 'no_active_condo', 400);
  const parsed = killSwitchSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());

  const next = parsed.data.auto_dispatch_enabled ? 1 : 0;
  const result = db.prepare(
    `UPDATE condominiums SET auto_dispatch_enabled = ? WHERE id = ?`
  ).run(next, condoId);
  if (result.changes === 0) return fail(res, 'condo_not_found', 404);

  audit(req, {
    action: 'admin.agent_kill_switch',
    target_type: 'condominium',
    target_id: condoId,
    condominium_id: condoId,
    metadata: { auto_dispatch_enabled: !!next },
  });

  return ok(res, { auto_dispatch_enabled: !!next });
});

export default router;
