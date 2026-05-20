import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, requireAuth } from '../lib/auth';
import { audit } from '../lib/audit';
import { ok, fail, asyncHandler } from '../lib/respond';
import {
  AGENCY_ROLES,
  AGENCY_EXPORT_KINDS,
  acceptAgencyStaffInvite,
  agencyPortfolioToCsv,
  agencyOperationalExportToCsv,
  assertAgencyMembershipCanUseCapability,
  agencyPortfoliosForUser,
  buildAgencyMonthlyReport,
  buildAgencyPortfolio,
  createAgencyStaffInvite,
  createAgencySetupCode,
  disableAgencySetupCode,
  listAgencySetupCodes,
  listAgencyAuditEvents,
  listAgencyStaff,
  listAgencyStaffInvites,
  recordAgencyStaffInviteEmailDelivery,
  removeAgencyStaff,
  switchAgencyActiveBuilding,
  updateAgencyStaff,
  upsertAgencyStaff,
  userAgencyMembership,
} from '../lib/agencies';
import type { AgencyRole } from '../lib/agencies';
import { sendAgencyStaffInviteEmail } from '../lib/email';
import db from '../db';

const router = Router();

const agencyIdParam = z.object({
  agencyId: z.coerce.number().int().positive(),
});

const setupCodeIdParam = agencyIdParam.extend({
  codeId: z.coerce.number().int().positive(),
});

const exportParam = agencyIdParam.extend({
  kind: z.enum(AGENCY_EXPORT_KINDS),
});

const staffMemberParam = agencyIdParam.extend({
  membershipId: z.coerce.number().int().positive(),
});

const agencyRoleSchema = z.enum(AGENCY_ROLES as [AgencyRole, ...AgencyRole[]]);

const setupCodeSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  code: z.string().trim().min(6).max(80).optional(),
  max_uses: z.coerce.number().int().min(1).max(500).optional(),
  expires_at: z.string().datetime().nullable().optional(),
});

const staffSchema = z.object({
  email: z.string().trim().email().max(255),
  role: agencyRoleSchema,
  building_ids: z.array(z.coerce.number().int().positive()).default([]),
});

const staffUpdateSchema = z.object({
  role: agencyRoleSchema.optional(),
  building_ids: z.array(z.coerce.number().int().positive()).optional(),
});

const acceptStaffInviteSchema = z.object({
  token: z.string().trim().min(20).max(200),
});

const activeBuildingSchema = z.object({
  condominium_id: z.coerce.number().int().positive(),
});

const auditEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const agencyReportQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

function parseParams<T extends z.ZodTypeAny>(schema: T, req: AuthedRequest): z.infer<T> | null {
  const parsed = schema.safeParse(req.params);
  if (!parsed.success) return null;
  return parsed.data;
}

function agencyMembershipOrFail(req: AuthedRequest, res: any, agencyId: number, adminOnly = false) {
  const membership = userAgencyMembership(req.user!.id, agencyId);
  if (!membership) {
    fail(res, 'agency_forbidden', 403);
    return null;
  }
  if (adminOnly && membership.role !== 'agency_admin') {
    fail(res, 'agency_admin_required', 403);
    return null;
  }
  return membership;
}

function failAgencyAccess(res: any, err: unknown): boolean {
  const status = (err as Error & { status?: number }).status;
  if (!status || status >= 500) return false;
  fail(res, (err as Error).message, status, {
    required_capability: (err as any).required_capability,
    export_kind: (err as any).export_kind,
  });
  return true;
}

router.get('/portfolio', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  return ok(res, { agencies: agencyPortfoliosForUser(req.user!.id) });
}));

router.post('/staff-invites/accept', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const parsed = acceptStaffInviteSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  try {
    const accepted = acceptAgencyStaffInvite({
      token: parsed.data.token,
      userId: req.user!.id,
    });
    audit(req, {
      action: 'agency.staff_invite_accept',
      target_type: 'agency_staff_invite',
      target_id: accepted.invite.id,
      metadata: {
        agency_id: accepted.invite.agency_id,
        role: accepted.staff.role,
        building_ids: accepted.staff.assigned_building_ids,
      },
    });
    const user = db.prepare(
      `SELECT id, email, role, condominium_id, first_name, last_name,
              unit_number, avatar_url, mobile_phone, home_phone, email_verified_at
       FROM users
       WHERE id = ?`
    ).get(req.user!.id);
    return ok(res, { invite: accepted.invite, staff: accepted.staff, user });
  } catch (err) {
    const status = (err as Error & { status?: number }).status || 500;
    if (status < 500) return fail(res, (err as Error).message, status);
    throw err;
  }
}));

router.post('/:agencyId/active-building', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const params = parseParams(agencyIdParam, req);
  if (!params) return fail(res, 'invalid_input', 400);
  const parsed = activeBuildingSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  try {
    const user = switchAgencyActiveBuilding({
      userId: req.user!.id,
      agencyId: params.agencyId,
      condominiumId: parsed.data.condominium_id,
    });
    audit(req, {
      action: 'agency.active_building_switch',
      target_type: 'condominium',
      target_id: parsed.data.condominium_id,
      metadata: {
        agency_id: params.agencyId,
      },
    });
    return ok(res, { user });
  } catch (err) {
    const status = (err as Error & { status?: number }).status || 500;
    if (status < 500) return fail(res, (err as Error).message, status);
    throw err;
  }
}));

router.get('/:agencyId/audit-events', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const params = parseParams(agencyIdParam, req);
  if (!params) return fail(res, 'invalid_input', 400);
  const parsed = auditEventsQuerySchema.safeParse(req.query);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const membership = agencyMembershipOrFail(req, res, params.agencyId, false);
  if (!membership) return;
  return ok(res, { events: listAgencyAuditEvents(membership, parsed.data.limit || 25) });
}));

router.get('/:agencyId/staff', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const params = parseParams(agencyIdParam, req);
  if (!params) return fail(res, 'invalid_input', 400);
  if (!agencyMembershipOrFail(req, res, params.agencyId, true)) return;
  return ok(res, {
    staff: listAgencyStaff(params.agencyId),
    invites: listAgencyStaffInvites(params.agencyId),
  });
}));

router.post('/:agencyId/staff', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const params = parseParams(agencyIdParam, req);
  if (!params) return fail(res, 'invalid_input', 400);
  const parsed = staffSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  if (!agencyMembershipOrFail(req, res, params.agencyId, true)) return;

  try {
    let staff;
    try {
      staff = upsertAgencyStaff({
        agencyId: params.agencyId,
        email: parsed.data.email,
        role: parsed.data.role,
        buildingIds: parsed.data.building_ids,
      });
    } catch (err) {
      if ((err as Error).message !== 'staff_user_not_found') throw err;
      const invite = createAgencyStaffInvite({
        agencyId: params.agencyId,
        email: parsed.data.email,
        role: parsed.data.role,
        buildingIds: parsed.data.building_ids,
        createdByUserId: req.user!.id,
      });
      const delivery = await sendAgencyStaffInviteEmail({
        to: invite.email,
        agencyName: invite.agency_name,
        role: invite.role,
        token: invite.token,
        senderName: `${req.user!.first_name} ${req.user!.last_name}`.trim() || req.user!.email,
      });
      recordAgencyStaffInviteEmailDelivery(invite.id, delivery);
      const savedInvite = listAgencyStaffInvites(params.agencyId).find((item) => item.id === invite.id) || invite;
      audit(req, {
        action: 'agency.staff_invite_create',
        target_type: 'agency_staff_invite',
        target_id: invite.id,
        metadata: {
          agency_id: params.agencyId,
          email: invite.email,
          role: invite.role,
          building_ids: invite.assigned_building_ids,
          email_status: delivery.status,
        },
      });
      return ok(res, { invite: { ...savedInvite, token: invite.token } }, 202);
    }
    audit(req, {
      action: 'agency.staff_upsert',
      target_type: 'agency_membership',
      target_id: staff.id,
      metadata: {
        agency_id: params.agencyId,
        staff_user_id: staff.user_id,
        role: staff.role,
        building_ids: staff.assigned_building_ids,
      },
    });
    return ok(res, { staff }, 201);
  } catch (err) {
    const status = (err as Error & { status?: number }).status || 500;
    if (status < 500) return fail(res, (err as Error).message, status);
    throw err;
  }
}));

router.post('/:agencyId/staff/:membershipId', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const params = parseParams(staffMemberParam, req);
  if (!params) return fail(res, 'invalid_input', 400);
  const parsed = staffUpdateSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  if (!agencyMembershipOrFail(req, res, params.agencyId, true)) return;

  try {
    const staff = updateAgencyStaff({
      agencyId: params.agencyId,
      membershipId: params.membershipId,
      role: parsed.data.role,
      buildingIds: parsed.data.building_ids,
    });
    audit(req, {
      action: 'agency.staff_update',
      target_type: 'agency_membership',
      target_id: staff.id,
      metadata: {
        agency_id: params.agencyId,
        staff_user_id: staff.user_id,
        role: staff.role,
        building_ids: staff.assigned_building_ids,
      },
    });
    return ok(res, { staff });
  } catch (err) {
    const status = (err as Error & { status?: number }).status || 500;
    if (status < 500) return fail(res, (err as Error).message, status);
    throw err;
  }
}));

router.delete('/:agencyId/staff/:membershipId', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const params = parseParams(staffMemberParam, req);
  if (!params) return fail(res, 'invalid_input', 400);
  if (!agencyMembershipOrFail(req, res, params.agencyId, true)) return;

  try {
    const staff = removeAgencyStaff({
      agencyId: params.agencyId,
      membershipId: params.membershipId,
      actorUserId: req.user!.id,
    });
    audit(req, {
      action: 'agency.staff_remove',
      target_type: 'agency_membership',
      target_id: staff.id,
      metadata: {
        agency_id: params.agencyId,
        staff_user_id: staff.user_id,
        role: staff.role,
      },
    });
    return ok(res, { staff });
  } catch (err) {
    const status = (err as Error & { status?: number }).status || 500;
    if (status < 500) return fail(res, (err as Error).message, status);
    throw err;
  }
}));

router.get('/:agencyId/setup-codes', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const params = parseParams(agencyIdParam, req);
  if (!params) return fail(res, 'invalid_input', 400);
  if (!agencyMembershipOrFail(req, res, params.agencyId, true)) return;
  return ok(res, { setup_codes: listAgencySetupCodes(params.agencyId) });
}));

router.post('/:agencyId/setup-codes', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const params = parseParams(agencyIdParam, req);
  if (!params) return fail(res, 'invalid_input', 400);
  const parsed = setupCodeSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  if (!agencyMembershipOrFail(req, res, params.agencyId, true)) return;

  try {
    const created = createAgencySetupCode({
      agencyId: params.agencyId,
      actorUserId: req.user!.id,
      label: parsed.data.label,
      code: parsed.data.code,
      maxUses: parsed.data.max_uses,
      expiresAt: parsed.data.expires_at,
    });
    audit(req, {
      action: 'agency.setup_code_create',
      target_type: 'private_setup_code',
      target_id: created.id,
      metadata: {
        agency_id: params.agencyId,
        label: created.label,
        max_uses: created.max_uses,
        expires_at: created.expires_at,
      },
    });
    return ok(res, { setup_code: created }, 201);
  } catch (err) {
    const status = (err as Error & { status?: number }).status || 500;
    if (status < 500) return fail(res, (err as Error).message, status);
    throw err;
  }
}));

router.post('/:agencyId/setup-codes/:codeId/disable', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const params = parseParams(setupCodeIdParam, req);
  if (!params) return fail(res, 'invalid_input', 400);
  if (!agencyMembershipOrFail(req, res, params.agencyId, true)) return;

  try {
    const setupCode = disableAgencySetupCode(params.agencyId, params.codeId);
    audit(req, {
      action: 'agency.setup_code_disable',
      target_type: 'private_setup_code',
      target_id: setupCode.id,
      metadata: {
        agency_id: params.agencyId,
        label: setupCode.label,
      },
    });
    return ok(res, { setup_code: setupCode });
  } catch (err) {
    const status = (err as Error & { status?: number }).status || 500;
    if (status < 500) return fail(res, (err as Error).message, status);
    throw err;
  }
}));

router.get('/:agencyId/export/portfolio.csv', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const params = parseParams(agencyIdParam, req);
  if (!params) return fail(res, 'invalid_input', 400);
  const membership = agencyMembershipOrFail(req, res, params.agencyId, false);
  if (!membership) return;
  try {
    assertAgencyMembershipCanUseCapability(membership, 'reports');
  } catch (err) {
    if (failAgencyAccess(res, err)) return;
    throw err;
  }
  const portfolio = buildAgencyPortfolio(membership);
  audit(req, {
    action: 'agency.export_portfolio',
    target_type: 'agency',
    target_id: params.agencyId,
    metadata: {
      buildings: portfolio.buildings.length,
    },
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="condoos-agency-${params.agencyId}-portfolio.csv"`);
  return res.status(200).send(agencyPortfolioToCsv(portfolio));
}));

router.get('/:agencyId/report.md', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const params = parseParams(agencyIdParam, req);
  if (!params) return fail(res, 'invalid_input', 400);
  const parsed = agencyReportQuerySchema.safeParse(req.query);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const membership = agencyMembershipOrFail(req, res, params.agencyId, false);
  if (!membership) return;
  try {
    assertAgencyMembershipCanUseCapability(membership, 'reports');
  } catch (err) {
    if (failAgencyAccess(res, err)) return;
    throw err;
  }
  const report = buildAgencyMonthlyReport(membership, parsed.data.month);
  audit(req, {
    action: 'agency.export_monthly_report',
    target_type: 'agency',
    target_id: params.agencyId,
    metadata: {
      agency_id: params.agencyId,
      month: report.month,
      buildings: report.buildings.length,
    },
  });
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="condoos-agency-${params.agencyId}-${report.month}.md"`);
  return res.status(200).send(report.markdown);
}));

router.get('/:agencyId/export/:kind.csv', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const params = parseParams(exportParam, req);
  if (!params) return fail(res, 'invalid_input', 400);
  const membership = agencyMembershipOrFail(req, res, params.agencyId, false);
  if (!membership) return;
  let csv: string;
  try {
    csv = agencyOperationalExportToCsv(membership, params.kind);
  } catch (err) {
    if (failAgencyAccess(res, err)) return;
    throw err;
  }
  audit(req, {
    action: 'agency.export_operational',
    target_type: 'agency',
    target_id: params.agencyId,
    metadata: {
      agency_id: params.agencyId,
      export_kind: params.kind,
    },
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="condoos-agency-${params.agencyId}-${params.kind}.csv"`);
  return res.status(200).send(csv);
}));

export default router;
