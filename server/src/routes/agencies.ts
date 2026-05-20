import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, requireAuth } from '../lib/auth';
import { audit } from '../lib/audit';
import { ok, fail, asyncHandler } from '../lib/respond';
import {
  agencyPortfolioToCsv,
  agencyPortfoliosForUser,
  buildAgencyPortfolio,
  createAgencySetupCode,
  disableAgencySetupCode,
  listAgencySetupCodes,
  userAgencyMembership,
} from '../lib/agencies';

const router = Router();

const agencyIdParam = z.object({
  agencyId: z.coerce.number().int().positive(),
});

const setupCodeIdParam = agencyIdParam.extend({
  codeId: z.coerce.number().int().positive(),
});

const setupCodeSchema = z.object({
  label: z.string().trim().min(1).max(120).optional(),
  code: z.string().trim().min(6).max(80).optional(),
  max_uses: z.coerce.number().int().min(1).max(500).optional(),
  expires_at: z.string().datetime().nullable().optional(),
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

export default router;
