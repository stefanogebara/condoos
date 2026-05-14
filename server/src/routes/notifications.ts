import { Router } from 'express';
import { AuthedRequest, requireAuth } from '../lib/auth';
import { fail, ok } from '../lib/respond';
import { listInAppNotifications, markInAppNotificationRead } from '../lib/in-app-notifications';

const router = Router();

router.get('/', requireAuth, (req: AuthedRequest, res) => {
  return ok(res, listInAppNotifications(req.user!.id, 25));
});

router.post('/:id/read', requireAuth, (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return fail(res, 'invalid_notification_id', 400);
  const notification = markInAppNotificationRead(req.user!.id, id);
  if (!notification) return fail(res, 'not_found', 404);
  return ok(res, notification);
});

export default router;
