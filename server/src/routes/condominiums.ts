import { Router } from 'express';
import { z } from 'zod';
import { AuthedRequest, getActiveCondoId, requireAuth, requireRole } from '../lib/auth';
import { audit } from '../lib/audit';
import { ok, fail } from '../lib/respond';
import { getCondoSettings, normalizeCondoSettingsInput, updateCondoSettings } from '../lib/condo-settings';

const router = Router();

const settingsSchema = z.object({
  country: z.enum(['BR', 'EC']),
  currency: z.enum(['BRL', 'USD']).optional(),
  timezone: z.string().min(1).max(80).optional(),
  locale: z.enum(['pt-BR', 'es-ES', 'en-US', 'fr-FR']).optional(),
  governance_mode: z.enum(['brazil_condominium', 'ecuador_condominium', 'neutral']).optional(),
});

router.get('/current', requireAuth, (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const settings = getCondoSettings(condoId);
  if (!settings) return fail(res, 'not_found', 404);
  return ok(res, settings);
});

router.patch('/current/settings', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const parsed = settingsSchema.safeParse(req.body);
  if (!parsed.success) return fail(res, 'invalid_input', 400, parsed.error.flatten());
  const condoId = getActiveCondoId(req);
  const normalized = normalizeCondoSettingsInput(parsed.data);
  const settings = updateCondoSettings(condoId, normalized);
  if (!settings) return fail(res, 'not_found', 404);
  audit(req, {
    action: 'condominium.settings_update',
    target_type: 'condominium',
    target_id: condoId,
    condominium_id: condoId,
    metadata: normalized,
  });
  return ok(res, settings);
});

export default router;
