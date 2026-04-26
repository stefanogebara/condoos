// /api/memberships — board admin pending-queue + member management.
import { Router } from 'express';
import { z } from 'zod';
import db from '../db';
import { requireAuth, requireRole, AuthedRequest } from '../lib/auth';
import { ok, fail, asyncHandler } from '../lib/respond';
import { EmailDeliveryResult, sendInviteEmail } from '../lib/email';
import { createRateLimit } from '../lib/rate-limit';

const router = Router();
const inviteWriteRateLimit = createRateLimit({ keyPrefix: 'membership_invites', windowMs: 60 * 60_000, max: 30 });

// GET /api/memberships/pending — all pending claims in admin's condo
router.get('/pending', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const u = req.user!;
  const rows = db.prepare(
    `SELECT uu.id, uu.relationship, uu.primary_contact, uu.created_at,
            usr.id AS user_id, usr.email, usr.first_name, usr.last_name, usr.avatar_url,
            un.id AS unit_id, un.number AS unit_number, un.floor,
            b.name AS building_name
     FROM user_unit uu
     JOIN users usr ON usr.id = uu.user_id
     JOIN units un  ON un.id  = uu.unit_id
     JOIN buildings b ON b.id = un.building_id
     WHERE b.condominium_id = ? AND uu.status = 'pending'
     ORDER BY uu.created_at ASC`
  ).all(u.condominium_id);
  return ok(res, rows);
});

// POST /api/memberships/:id/approve
router.post('/:id/approve', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const u = req.user!;

  const row = db.prepare(
    `SELECT uu.id, uu.user_id, uu.unit_id, uu.status,
            un.number AS unit_number, b.condominium_id
     FROM user_unit uu
     JOIN units un ON un.id = uu.unit_id
     JOIN buildings b ON b.id = un.building_id
     WHERE uu.id = ?`
  ).get(id) as any;
  if (!row) return fail(res, 'not_found', 404);
  if (row.condominium_id !== u.condominium_id) return fail(res, 'forbidden', 403);
  if (row.status !== 'pending') return fail(res, 'not_pending', 409);

  db.transaction(() => {
    db.prepare(
      `UPDATE user_unit
       SET status = 'active', move_in_date = COALESCE(move_in_date, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(id);
    db.prepare(
      `UPDATE users SET condominium_id = ?, unit_number = ? WHERE id = ?`
    ).run(row.condominium_id, row.unit_number, row.user_id);
  })();

  return ok(res, { id, status: 'active' });
});

// POST /api/memberships/:id/deny
router.post('/:id/deny', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  const u = req.user!;
  const row = db.prepare(
    `SELECT uu.id, uu.status, b.condominium_id
     FROM user_unit uu
     JOIN units un ON un.id = uu.unit_id
     JOIN buildings b ON b.id = un.building_id
     WHERE uu.id = ?`
  ).get(id) as any;
  if (!row) return fail(res, 'not_found', 404);
  if (row.condominium_id !== u.condominium_id) return fail(res, 'forbidden', 403);
  db.prepare(`UPDATE user_unit SET status = 'revoked', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
  return ok(res, { id, status: 'revoked' });
});

// POST /api/memberships/import-csv — bulk-create pre-assigned invites.
// Body: { csv: "email,unit,relationship,primary_contact,voting_weight\njordan@x.com,612,tenant,yes,1\n..." }
// Each row creates an invites row (status=pending) scoped to the admin's condo.
// When a user later signs in with a matching email, we auto-activate them.
const csvSchema = z.object({
  csv: z.string().min(3).max(100_000),
  send_emails: z.boolean().optional().default(true),
});

function persistInviteEmailStatus(inviteId: number, delivery: EmailDeliveryResult) {
  db.prepare(
    `UPDATE invites
     SET email_status = ?,
         email_sent_at = CASE WHEN ? = 'sent' THEN CURRENT_TIMESTAMP ELSE email_sent_at END,
         email_error = ?
     WHERE id = ?`
  ).run(delivery.status, delivery.status, delivery.error || null, inviteId);
}

function recordQueuedInviteEmail(
  inviteId: number,
  deliveryPromise: Promise<EmailDeliveryResult>,
) {
  void deliveryPromise
    .then((delivery) => {
      persistInviteEmailStatus(inviteId, delivery);
    })
    .catch((err) => {
      const delivery: EmailDeliveryResult = {
        status: 'failed',
        provider: 'resend',
        error: err instanceof Error ? err.message : 'invite_email_failed',
      };
      console.error(`[email] invite delivery failed for invite ${inviteId}: ${delivery.error}`);
      persistInviteEmailStatus(inviteId, delivery);
    });
}

router.post('/import-csv', inviteWriteRateLimit, requireAuth, requireRole('board_admin'), asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = csvSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const u = req.user!;
  const condo = db.prepare(`SELECT name, invite_code FROM condominiums WHERE id = ?`).get(u.condominium_id) as
    | { name: string; invite_code: string | null }
    | undefined;
  if (!condo?.invite_code) return fail(res, 'missing_invite_code', 500);

  // Very small CSV parser: header row optional, columns = email,unit,[relationship],[primary_contact],[voting_weight]
  const lines = parsed.data.csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return fail(res, 'empty_csv');

  // Detect header
  const first = lines[0].toLowerCase();
  const hasHeader = first.includes('email') || first.includes('unit');
  const dataLines = hasHeader ? lines.slice(1) : lines;

  const findUnit = db.prepare(
    `SELECT u.id, u.number FROM units u
     JOIN buildings b ON b.id = u.building_id
     WHERE b.condominium_id = ? AND LOWER(u.number) = LOWER(?)`
  );
  const insertInvite = db.prepare(
    `INSERT INTO invites (condominium_id, email, unit_id, role, relationship, primary_contact, voting_weight, status)
     VALUES (?, ?, ?, 'resident', ?, ?, ?, 'pending')`
  );

  const imported: any[] = [];
  const errors: any[] = [];

  const tx = db.transaction(() => {
    for (let i = 0; i < dataLines.length; i++) {
      const cols = dataLines[i].split(',').map((c) => c.trim());
      if (cols.length < 2) { errors.push({ row: i + 1, error: 'need_email_and_unit' }); continue; }
      const [email, unit, rel, primaryRaw, weightRaw] = cols;
      if (!email || !email.includes('@')) { errors.push({ row: i + 1, error: 'invalid_email' }); continue; }
      const unitRow = findUnit.get(u.condominium_id, unit) as { id: number; number: string } | undefined;
      if (!unitRow) { errors.push({ row: i + 1, error: 'unit_not_found', unit }); continue; }
      const relationship = ['owner', 'tenant', 'occupant'].includes((rel || '').toLowerCase())
        ? (rel as string).toLowerCase()
        : 'tenant';
      const primary = /^(1|true|yes|y)$/i.test(primaryRaw || '') ? 1 : 0;
      const votingWeight = Number.isFinite(Number(weightRaw)) && Number(weightRaw) > 0
        ? Number(weightRaw)
        : 1;
      // Skip if an active pending invite already exists for this email+unit.
      const dup = db.prepare(
        `SELECT id FROM invites WHERE condominium_id=? AND email=? AND unit_id=? AND status='pending'`
      ).get(u.condominium_id, email.toLowerCase(), unitRow.id);
      if (dup) { errors.push({ row: i + 1, error: 'already_invited', email, unit }); continue; }

      const inv = insertInvite.run(
        u.condominium_id,
        email.toLowerCase(),
        unitRow.id,
        relationship,
        primary,
        votingWeight,
      );
      imported.push({ row: i + 1, invite_id: Number(inv.lastInsertRowid), email: email.toLowerCase(), unit: unitRow.number, relationship, primary_contact: primary, voting_weight: votingWeight });
    }
  });
  tx();

  const emailDelivery: Array<{ invite_id: number; email: string; queued: boolean }> = [];
  if (parsed.data.send_emails) {
    for (const invite of imported) {
      recordQueuedInviteEmail(invite.invite_id, sendInviteEmail({
        to: invite.email,
        condoName: condo.name,
        inviteCode: condo.invite_code,
        unitNumber: invite.unit,
        relationship: invite.relationship,
        senderName: `${u.first_name} ${u.last_name}`.trim(),
      }));
      emailDelivery.push({ invite_id: invite.invite_id, email: invite.email, queued: true });
    }
  }

  return ok(res, { imported_count: imported.length, error_count: errors.length, imported, errors, email_delivery: emailDelivery });
}));

// GET /api/memberships/invites — list pending invites so admin can see who's expected.
router.get('/invites', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const u = req.user!;
  const rows = db.prepare(
    `SELECT i.id, i.email, i.status, i.relationship, i.primary_contact, i.voting_weight,
            i.email_status, i.email_sent_at, i.email_error,
            i.created_at, i.claimed_by_user_id,
            un.id AS unit_id, un.number AS unit_number, un.floor, b.name AS building_name
     FROM invites i
     JOIN units un ON un.id = i.unit_id
     JOIN buildings b ON b.id = un.building_id
     WHERE i.condominium_id = ?
     ORDER BY i.created_at DESC`
  ).all(u.condominium_id);
  return ok(res, rows);
});

router.post('/invites/:id/send-email', inviteWriteRateLimit, requireAuth, requireRole('board_admin'), asyncHandler(async (req: AuthedRequest, res) => {
  const u = req.user!;
  const id = Number(req.params.id);
  const row = db.prepare(
    `SELECT i.id, i.email, i.status, i.relationship, i.condominium_id,
            un.number AS unit_number, c.name AS condo_name, c.invite_code
     FROM invites i
     JOIN units un ON un.id = i.unit_id
     JOIN condominiums c ON c.id = i.condominium_id
     WHERE i.id = ?`
  ).get(id) as any;
  if (!row || row.condominium_id !== u.condominium_id) return fail(res, 'not_found', 404);
  if (row.status !== 'pending') return fail(res, 'invite_not_pending', 409);
  if (!row.email) return fail(res, 'invite_missing_email', 400);
  if (!row.invite_code) return fail(res, 'missing_invite_code', 500);

  const delivery = await sendInviteEmail({
    to: row.email,
    condoName: row.condo_name,
    inviteCode: row.invite_code,
    unitNumber: row.unit_number,
    relationship: row.relationship,
    senderName: `${u.first_name} ${u.last_name}`.trim(),
  });
  persistInviteEmailStatus(row.id, delivery);

  if (delivery.status === 'sent') return ok(res, { id: row.id, delivery });
  return fail(res, delivery.error || 'email_delivery_failed', delivery.status === 'skipped' ? 503 : 502, delivery);
}));

// POST /api/memberships/:id/reassign  — move a pending claim to a different unit
const reassignSchema = z.object({ unit_id: z.number().int() });
router.post('/:id/reassign', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const parsed = reassignSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const id = Number(req.params.id);
  const u = req.user!;
  const row = db.prepare(
    `SELECT uu.id, uu.status, b.condominium_id
     FROM user_unit uu
     JOIN units un ON un.id = uu.unit_id
     JOIN buildings b ON b.id = un.building_id
     WHERE uu.id = ?`
  ).get(id) as any;
  if (!row) return fail(res, 'not_found', 404);
  if (row.condominium_id !== u.condominium_id) return fail(res, 'forbidden', 403);

  const newUnit = db.prepare(
    `SELECT u.id, b.condominium_id FROM units u JOIN buildings b ON b.id = u.building_id WHERE u.id = ?`
  ).get(parsed.data.unit_id) as any;
  if (!newUnit || newUnit.condominium_id !== u.condominium_id)
    return fail(res, 'unit_not_in_condo', 400);
  db.prepare(`UPDATE user_unit SET unit_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .run(parsed.data.unit_id, id);
  return ok(res, { id, unit_id: parsed.data.unit_id });
});

export default router;
