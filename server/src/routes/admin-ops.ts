// Admin-only operational endpoints. Currently just backup status + a
// manual trigger; future home for "snapshot now before risky migration",
// "rebuild scorecards", etc.
import { Router } from 'express';
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

export default router;
