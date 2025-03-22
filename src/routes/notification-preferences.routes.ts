import { Router } from 'express';
import { NotificationPreferencesController } from '../controllers/notification-preferences.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// Get user's notification preferences
router.get(
  '/',
  authenticateToken,
  NotificationPreferencesController.getPreferences
);

// Update user's notification preferences
router.patch(
  '/',
  authenticateToken,
  NotificationPreferencesController.updatePreferences
);

export default router; 