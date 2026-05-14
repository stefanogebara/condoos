import { Router } from 'express';
import { AuthedRequest, getActiveCondoId, requireAuth } from '../lib/auth';
import { ok } from '../lib/respond';
import { getDashboardActions } from '../lib/dashboard-actions';

const router = Router();

router.get('/actions', requireAuth, (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  return ok(res, getDashboardActions(req.user!, condoId));
});

export default router;
