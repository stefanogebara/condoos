import { Router } from 'express';
import db from '../db';
import { requireAuth, getActiveCondoId, AuthedRequest } from '../lib/auth';
import { ok } from '../lib/respond';

const router = Router();

router.get('/residents', requireAuth, (req: AuthedRequest, res) => {
  const condoId = getActiveCondoId(req);
  const rows = db.prepare(
    `SELECT
       usr.id,
       usr.first_name,
       usr.last_name,
       GROUP_CONCAT(DISTINCT un.number) AS unit_number,
       usr.role,
       usr.email
     FROM user_unit uu
     JOIN users usr ON usr.id = uu.user_id
     JOIN units un ON un.id = uu.unit_id
     JOIN buildings b ON b.id = un.building_id
     WHERE b.condominium_id = ? AND uu.status = 'active'
     GROUP BY usr.id
     ORDER BY MIN(CASE WHEN un.floor IS NULL THEN 9999 ELSE un.floor END), MIN(un.number), usr.last_name`
  ).all(condoId);
  return ok(res, rows);
});

export default router;
