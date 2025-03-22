import { Request, Response } from 'express';
import { NotificationService } from '../services/notification.service';
import { NotificationPreferences } from '../types/notification';

export class NotificationPreferencesController {
  static async getPreferences(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const preferences = await NotificationService.getUserPreferences(userId);

      if (!preferences) {
        res.status(404).json({ message: 'Notification preferences not found' });
        return;
      }

      res.json(preferences);
    } catch (error) {
      console.error('Error fetching notification preferences:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async updatePreferences(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.userId;
      const updates = req.body as Partial<NotificationPreferences>;

      // Validate input
      if (!updates || typeof updates !== 'object') {
        res.status(400).json({ message: 'Invalid preferences format' });
        return;
      }

      // Validate notification types if provided
      if (updates.notificationTypes) {
        for (const [type, settings] of Object.entries(updates.notificationTypes)) {
          if (typeof settings !== 'object' || settings === null) {
            res.status(400).json({ 
              message: `Invalid settings for notification type: ${type}` 
            });
            return;
          }

          if ('enabled' in settings && typeof settings.enabled !== 'boolean') {
            res.status(400).json({ 
              message: `Invalid enabled setting for notification type: ${type}` 
            });
            return;
          }

          if ('email' in settings && typeof settings.email !== 'boolean') {
            res.status(400).json({ 
              message: `Invalid email setting for notification type: ${type}` 
            });
            return;
          }

          if ('push' in settings && typeof settings.push !== 'boolean') {
            res.status(400).json({ 
              message: `Invalid push setting for notification type: ${type}` 
            });
            return;
          }
        }
      }

      // Validate email and push notification settings if provided
      if ('emailNotifications' in updates && 
          typeof updates.emailNotifications !== 'boolean') {
        res.status(400).json({ 
          message: 'Invalid email notifications setting' 
        });
        return;
      }

      if ('pushNotifications' in updates && 
          typeof updates.pushNotifications !== 'boolean') {
        res.status(400).json({ 
          message: 'Invalid push notifications setting' 
        });
        return;
      }

      const updatedPreferences = await NotificationService.updateUserPreferences(
        userId,
        updates
      );

      res.json({
        message: 'Notification preferences updated successfully',
        preferences: updatedPreferences
      });
    } catch (error) {
      console.error('Error updating notification preferences:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
} 