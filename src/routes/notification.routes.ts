import { Router } from 'express';
import { NotificationController } from '../controllers/notification.controller';
import { NotificationPreferencesController } from '../controllers/notification-preferences.controller';
import { authenticateToken } from '../middleware/auth';

const router = Router();

// Notification routes
router.get('/', authenticateToken, NotificationController.getUserNotifications);
router.get('/unread', authenticateToken, NotificationController.getUnreadNotifications);
router.patch('/:notificationId/read', authenticateToken, NotificationController.markAsRead);
router.patch('/read-all', authenticateToken, NotificationController.markAllAsRead);

// Notification preferences routes
router.get('/preferences', authenticateToken, NotificationPreferencesController.getPreferences);
router.patch('/preferences', authenticateToken, NotificationPreferencesController.updatePreferences);

export default router; 