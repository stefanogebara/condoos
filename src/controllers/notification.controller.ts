import { Request, Response } from 'express';
import { NotificationService } from '../services/notification.service';

export class NotificationController {
  static async getUserNotifications(req: Request, res: Response) {
    try {
      const userId = req.user!.userId;
      const notifications = await NotificationService.getUserNotifications(userId);
      res.json(notifications);
    } catch (error) {
      console.error('Error fetching notifications:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async getUnreadNotifications(req: Request, res: Response) {
    try {
      const userId = req.user!.userId;
      const notifications = await NotificationService.getUnreadNotifications(userId);
      res.json(notifications);
    } catch (error) {
      console.error('Error fetching unread notifications:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async markAsRead(req: Request, res: Response) {
    try {
      const userId = req.user!.userId;
      const notificationId = parseInt(req.params.notificationId);

      if (isNaN(notificationId)) {
        return res.status(400).json({ message: 'Invalid notification ID' });
      }

      await NotificationService.markAsRead(notificationId, userId);
      res.json({ message: 'Notification marked as read' });
    } catch (error) {
      console.error('Error marking notification as read:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }

  static async markAllAsRead(req: Request, res: Response) {
    try {
      const userId = req.user!.userId;
      await NotificationService.markAllAsRead(userId);
      res.json({ message: 'All notifications marked as read' });
    } catch (error) {
      console.error('Error marking all notifications as read:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  }
} 