import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, requireAuth } from '../lib/auth';
import { audit } from '../lib/audit';
import { ok, fail, asyncHandler } from '../lib/respond';
import {
  AGENCY_ROLES,
  AGENCY_EXPORT_KINDS,
  agencyPortfolioToCsv,
  agencyOperationalExportToCsv,
  agencyPortfoliosForUser,
  buildAgencyPortfolio,
  createAgencySetupCode,
  disableAgencySetupCode,
  listAgencySetupCodes,
  listAgencyAuditEvents,
  listAgencyStaff,
  removeAgencyStaff,
  updateAgencyStaff,
  upsertAgencyStaff,
  userAgencyMembership,
} from '../lib/agencies';
import type { AgencyRole } from '../lib/agencies';

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

const auditEventsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
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

router.get('/portfolio', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  return ok(res, { agencies: agencyPortfoliosForUser(req.user!.id) });
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
  return ok(res, { staff: listAgencyStaff(params.agencyId) });
}));

router.post('/:agencyId/staff', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const params = parseParams(agencyIdParam, req);
  if (!params) return fail(res, 'invalid_input', 400);
  const parsed = staffSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  if (!agencyMembershipOrFail(req, res, params.agencyId, true)) return;

  try {
    const staff = upsertAgencyStaff({
      agencyId: params.agencyId,
      email: parsed.data.email,
      role: parsed.data.role,
      buildingIds: parsed.data.building_ids,
    });
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

router.get('/:agencyId/export/:kind.csv', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const params = parseParams(exportParam, req);
  if (!params) return fail(res, 'invalid_input', 400);
  const membership = agencyMembershipOrFail(req, res, params.agencyId, false);
  if (!membership) return;
  const csv = agencyOperationalExportToCsv(membership, params.kind);
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
