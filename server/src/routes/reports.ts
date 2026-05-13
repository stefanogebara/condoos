import { Router } from 'express';
import { AuthedRequest, getActiveCondoId, requireAuth, requireRole } from '../lib/auth';
import { fail, ok } from '../lib/respond';
import { getBoardPacket, normalizeBoardPacketMonth } from '../lib/board-packet';

const router = Router();

router.get('/board-packet', requireAuth, requireRole('board_admin'), (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const rawMonth = typeof req.query.month === 'string' ? req.query.month : undefined;
  let month: string;
  try {
    month = normalizeBoardPacketMonth(rawMonth);
  } catch {
    return fail(res, 'invalid_month', 400);
  }
  const packet = getBoardPacket(condoId, month);
  return ok(res, packet);
});

export default router;
