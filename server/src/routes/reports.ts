import { Router } from 'express';
import { AuthedRequest, getActiveCondoId, requireAuth, requireRole, requireBoardCapability } from '../lib/auth';
import { audit } from '../lib/audit';
import { asyncHandler, fail, ok } from '../lib/respond';
import { buildBoardPacketPdf, getBoardPacket, normalizeBoardPacketMonth } from '../lib/board-packet';

const router = Router();

router.get('/board-packet', requireAuth, requireRole('board_admin'), requireBoardCapability('reports'), (req: AuthedRequest, res) => {
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

router.get('/board-packet.pdf', requireAuth, requireRole('board_admin'), requireBoardCapability('reports'), asyncHandler(async (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const rawMonth = typeof req.query.month === 'string' ? req.query.month : undefined;
  let month: string;
  try {
    month = normalizeBoardPacketMonth(rawMonth);
  } catch {
    return fail(res, 'invalid_month', 400);
  }
  const packet = getBoardPacket(condoId, month);
  const pdf = await buildBoardPacketPdf(packet);
  audit(req, {
    action: 'report.board_packet_pdf_export',
    target_type: 'condominium',
    target_id: condoId,
    metadata: { month: packet.month },
  });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="condoos-board-packet-${packet.month}.pdf"`);
  return res.status(200).send(pdf);
}));

export default router;
