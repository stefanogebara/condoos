// Admin-only operational endpoints. Backup status/run/verify live here,
// plus future "snapshot now before risky migration", "rebuild scorecards", etc.
import { Router } from 'express';
import { z } from 'zod';
import db from '../db';
import { requireAuth, requireRole, requireBoardCapability, AuthedRequest } from '../lib/auth';
import { ok, fail, asyncHandler } from '../lib/respond';
import { createRateLimit } from '../lib/rate-limit';
import { audit } from '../lib/audit';
import { runBackup, getBackupStatus, backupConfigured, verifyBackupObject, runRestoreDrill } from '../lib/backup';
import { getWhatsAppStatus } from '../lib/whatsapp';
import { privateCreateBuildingRequired } from '../lib/private-access';
import { getQueueStatusSnapshot } from '../lib/agent-dispatch-queue';
import { captureMessage } from '../lib/sentry';

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

const backupVerifyRateLimit = createRateLimit({
  keyPrefix: 'admin-backup-verify',
  windowMs: 60 * 60_000,
  max: 10,
  key: (req) => String((req as AuthedRequest).user?.id || req.ip || 'unknown'),
});

const backupRestoreDrillRateLimit = createRateLimit({
  keyPrefix: 'admin-backup-restore-drill',
  windowMs: 60 * 60_000,
  max: 6,
  key: (req) => String((req as AuthedRequest).user?.id || req.ip || 'unknown'),
});

router.get('/backup/status', requireAuth, requireRole('board_admin'), requireBoardCapability('building_admin'), (_req: AuthedRequest, res) => {
  return ok(res, getBackupStatus());
});

router.get('/integrations/status', requireAuth, requireRole('board_admin'), requireBoardCapability('building_admin'), (_req: AuthedRequest, res) => {
  const activeSetupCodes = db.prepare(
    `SELECT COUNT(*) AS count
     FROM private_setup_codes
     WHERE disabled_at IS NULL
       AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
       AND used_count < max_uses`
  ).get() as { count: number };
  const privateRequired = privateCreateBuildingRequired();
  const privateEnvCodes = String(process.env.PRIVATE_SETUP_CODES || '').split(',').map((s) => s.trim()).filter(Boolean).length;
  const r2Configured = !!(
    process.env.R2_BUCKET
    && process.env.R2_ENDPOINT
    && process.env.R2_ACCESS_KEY_ID
    && process.env.R2_SECRET_ACCESS_KEY
  );
  const emailProvider = process.env.EMAIL_PROVIDER || (process.env.RESEND_API_KEY ? 'resend' : 'none');
  const emailConfigured = emailProvider === 'resend' && !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;

  return ok(res, {
    private_access: {
      configured: !privateRequired || privateEnvCodes > 0 || Number(activeSetupCodes.count || 0) > 0,
      required: privateRequired,
      active_setup_codes: Number(activeSetupCodes.count || 0),
      env_setup_codes: privateEnvCodes,
    },
    email: {
      configured: emailConfigured,
      provider: emailProvider,
      from_configured: !!process.env.EMAIL_FROM,
    },
    google_login: {
      configured: !!process.env.GOOGLE_CLIENT_ID,
    },
    whatsapp: getWhatsAppStatus(),
    uploads: {
      configured: r2Configured,
      driver: r2Configured ? 'r2' : 'local',
      bucket_configured: !!process.env.R2_BUCKET,
    },
    ai: {
      configured: !!process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_MODEL || 'anthropic/claude-3.5-haiku',
    },
    backups: getBackupStatus(),
    observability: {
      sentry_configured: !!process.env.SENTRY_DSN,
      posthog_configured: !!(process.env.POSTHOG_KEY || process.env.VITE_POSTHOG_KEY),
    },
  });
});

router.post('/backup/run', requireAuth, requireRole('board_admin'), requireBoardCapability('building_admin'), backupRateLimit, asyncHandler(async (req: AuthedRequest, res) => {
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

const verifyBackupSchema = z.object({
  key: z.string().min(1).max(512).optional(),
});

router.post('/backup/verify', requireAuth, requireRole('board_admin'), requireBoardCapability('building_admin'), backupVerifyRateLimit, asyncHandler(async (req: AuthedRequest, res) => {
  if (!backupConfigured()) return fail(res, 'backup_not_configured', 503);
  const parsed = verifyBackupSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());

  const result = await verifyBackupObject(parsed.data.key);
  audit(req, {
    action: 'admin.backup_verify',
    target_type: 'backup',
    target_id: 0,
    condominium_id: req.user?.condominium_id ?? null,
    metadata: {
      ok: result.ok,
      key: result.key,
      object_size_bytes: result.object_size_bytes,
      restored_size_bytes: result.restored_size_bytes,
      integrity_check: result.integrity_check,
      error: result.error,
    },
  });
  if (!result.ok) return fail(res, result.error || 'backup_verify_failed', 500, result);
  return ok(res, result);
}));

router.post('/backup/restore-drill', requireAuth, requireRole('board_admin'), requireBoardCapability('building_admin'), backupRestoreDrillRateLimit, asyncHandler(async (req: AuthedRequest, res) => {
  if (!backupConfigured()) return fail(res, 'backup_not_configured', 503);
  const parsed = verifyBackupSchema.safeParse(req.body || {});
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());

  const result = await runRestoreDrill(parsed.data.key);
  audit(req, {
    action: 'admin.backup_restore_drill',
    target_type: 'backup',
    target_id: 0,
    condominium_id: req.user?.condominium_id ?? null,
    metadata: {
      ok: result.ok,
      key: result.key,
      object_size_bytes: result.object_size_bytes,
      restored_size_bytes: result.restored_size_bytes,
      integrity_check: result.integrity_check,
      foreign_key_violations: result.foreign_key_violations,
      schema_table_count: result.schema_table_count,
      writable_probe: result.writable_probe,
      error: result.error,
    },
  });
  if (!result.ok) return fail(res, result.error || 'backup_restore_drill_failed', 500, result);
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

router.get('/agent/kill-switch', requireAuth, requireRole('board_admin'), requireBoardCapability('building_admin'), (req: AuthedRequest, res) => {
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

router.patch('/agent/kill-switch', requireAuth, requireRole('board_admin'), requireBoardCapability('building_admin'), killSwitchRateLimit, (req: AuthedRequest, res) => {
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

  // Ops event — surfaces in the Sentry dashboard so a spike of
  // pauses (e.g. an admin reacting to a bad dispatch) gets noticed.
  // info severity because this is informational; the audit log
  // remains the source of truth for who/when.
  captureMessage('agent.kill_switch.toggled', 'info', {
    condo_id: condoId,
    auto_dispatch_enabled: !!next,
    actor_user_id: req.user?.id,
  });

  return ok(res, { auto_dispatch_enabled: !!next });
});

// Observability — dispatch queue snapshot. Polled by the BoardAgent
// ops panel every 10-15s to surface queue health (counts, lag,
// recent failures). Scoped to the caller's condo so an admin sees
// only their own building's queue.
router.get('/agent/queue/status', requireAuth, requireRole('board_admin'), requireBoardCapability('building_admin'), (req: AuthedRequest, res) => {
  const condoId = req.user?.condominium_id;
  if (!condoId) return fail(res, 'no_active_condo', 400);
  return ok(res, getQueueStatusSnapshot(condoId));
});

export default router;
