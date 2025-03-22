import { pool } from '../db/pool';
import { Notification, NotificationType, NotificationRow, NotificationPreferences } from '../types/notification';
import { Project } from '../types/project';
import { WebSocketService } from './websocket.service';
import { EmailService } from './email.service';

export class NotificationService {
  static async createNotification(
    userId: number,
    projectId: number,
    type: NotificationType,
    message: string,
    metadata?: Record<string, any>
  ): Promise<Notification | null> {
    // Check user's notification preferences
    const preferences = await this.getUserPreferences(userId);
    if (!preferences || !preferences.notificationTypes[type].enabled) {
      return null;
    }

    const result = await pool.query<NotificationRow>(
      `INSERT INTO notifications (user_id, project_id, type, message, metadata)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, projectId, type, message, metadata ? JSON.stringify(metadata) : null]
    );

    const notification = this.transformNotification(result.rows[0]);

    // Send real-time notification if enabled
    if (preferences.pushNotifications && preferences.notificationTypes[type].push) {
      WebSocketService.sendNotification(userId, notification);
    }

    // Send email notification if enabled
    if (preferences.emailNotifications && preferences.notificationTypes[type].email) {
      const userEmail = await this.getUserEmail(userId);
      if (userEmail) {
        await EmailService.sendNotificationEmail(userEmail, notification);
      }
    }

    return notification;
  }

  static async getUserPreferences(userId: number): Promise<NotificationPreferences | null> {
    const result = await pool.query(
      `SELECT * FROM notification_preferences WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      userId: row.user_id,
      emailNotifications: row.email_notifications,
      pushNotifications: row.push_notifications,
      notificationTypes: row.preferences
    };
  }

  static async updateUserPreferences(
    userId: number,
    preferences: Partial<NotificationPreferences>
  ): Promise<NotificationPreferences> {
    const result = await pool.query(
      `UPDATE notification_preferences
       SET email_notifications = $2,
           push_notifications = $3,
           preferences = $4
       WHERE user_id = $1
       RETURNING *`,
      [
        userId,
        preferences.emailNotifications,
        preferences.pushNotifications,
        JSON.stringify(preferences.notificationTypes)
      ]
    );

    const row = result.rows[0];
    return {
      userId: row.user_id,
      emailNotifications: row.email_notifications,
      pushNotifications: row.push_notifications,
      notificationTypes: row.preferences
    };
  }

  static async getUserNotifications(userId: number): Promise<Notification[]> {
    const result = await pool.query<NotificationRow>(
      `SELECT * FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    return result.rows.map(this.transformNotification);
  }

  static async getUnreadNotifications(userId: number): Promise<Notification[]> {
    const result = await pool.query<NotificationRow>(
      `SELECT * FROM notifications
       WHERE user_id = $1 AND is_read = false
       ORDER BY created_at DESC`,
      [userId]
    );

    return result.rows.map(this.transformNotification);
  }

  static async markAsRead(notificationId: number, userId: number): Promise<void> {
    await pool.query(
      `UPDATE notifications
       SET is_read = true
       WHERE id = $1 AND user_id = $2`,
      [notificationId, userId]
    );
  }

  static async markAllAsRead(userId: number): Promise<void> {
    await pool.query(
      `UPDATE notifications
       SET is_read = true
       WHERE user_id = $1`,
      [userId]
    );
  }

  static async notifyProjectStatusChange(
    project: Project,
    newStatus: string
  ): Promise<void> {
    const metadata = {
      oldStatus: project.status,
      newStatus
    };

    // Notify project creator
    await this.createNotification(
      project.creatorId,
      project.id,
      'status_update',
      `Your project "${project.title}" status has been updated to ${newStatus}`,
      metadata
    );

    // Get all users who voted on the project
    const result = await pool.query(
      `SELECT DISTINCT user_id FROM project_votes WHERE project_id = $1`,
      [project.id]
    );

    // Notify all voters
    for (const row of result.rows) {
      if (row.user_id !== project.creatorId) {
        await this.createNotification(
          row.user_id,
          project.id,
          'status_update',
          `Project "${project.title}" that you voted on has been updated to ${newStatus}`,
          metadata
        );
      }
    }
  }

  static async notifyNewVote(
    project: Project,
    voterId: number,
    vote: boolean
  ): Promise<void> {
    // Notify project creator
    if (project.creatorId !== voterId) {
      await this.createNotification(
        project.creatorId,
        project.id,
        'new_vote',
        `A new ${vote ? 'positive' : 'negative'} vote has been cast on your project "${project.title}"`
      );
    }

    // Check if vote threshold has been reached (e.g., 10 votes)
    const result = await pool.query(
      `SELECT 
        COUNT(*) as total_votes,
        COUNT(CASE WHEN vote = true THEN 1 END) as yes_votes
       FROM project_votes
       WHERE project_id = $1`,
      [project.id]
    );

    const { total_votes, yes_votes } = result.rows[0];
    if (total_votes >= 10) {
      const approval_rate = (yes_votes / total_votes) * 100;
      await this.createNotification(
        project.creatorId,
        project.id,
        'vote_threshold',
        `Your project "${project.title}" has reached ${total_votes} votes with ${approval_rate.toFixed(1)}% approval rate`
      );
    }
  }

  static async notifyNewComment(
    project: Project,
    commenterId: number
  ): Promise<void> {
    // Notify project creator
    if (project.creatorId !== commenterId) {
      await this.createNotification(
        project.creatorId,
        project.id,
        'new_comment',
        `A new comment has been added to your project "${project.title}"`
      );
    }

    // Get all unique users who commented on the project
    const result = await pool.query(
      `SELECT DISTINCT user_id FROM project_comments WHERE project_id = $1 AND user_id != $2`,
      [project.id, commenterId]
    );

    // Notify all previous commenters except the current commenter
    for (const row of result.rows) {
      if (row.user_id !== project.creatorId) {
        await this.createNotification(
          row.user_id,
          project.id,
          'new_comment',
          `A new comment has been added to project "${project.title}" that you participated in`
        );
      }
    }
  }

  static async notifyBudgetUpdate(
    project: Project,
    oldCost: number,
    newCost: number
  ): Promise<void> {
    const metadata = {
      oldCost,
      newCost,
      difference: newCost - oldCost
    };

    await this.createNotification(
      project.creatorId,
      project.id,
      'budget_update',
      `The budget for your project "${project.title}" has been updated from $${oldCost} to $${newCost}`,
      metadata
    );
  }

  static async notifyDocumentUpload(
    project: Project,
    documentName: string,
    documentType: string
  ): Promise<void> {
    const metadata = {
      documentName,
      documentType
    };

    await this.createNotification(
      project.creatorId,
      project.id,
      'document_upload',
      `A new document "${documentName}" has been uploaded to your project "${project.title}"`,
      metadata
    );
  }

  static async notifyMaintenanceSchedule(
    project: Project,
    schedule: { date: string; description: string }
  ): Promise<void> {
    await this.createNotification(
      project.creatorId,
      project.id,
      'maintenance_schedule',
      `Maintenance has been scheduled for your project "${project.title}" on ${schedule.date}`,
      schedule
    );
  }

  private static async getUserEmail(userId: number): Promise<string | null> {
    const result = await pool.query(
      `SELECT email FROM users WHERE id = $1`,
      [userId]
    );
    return result.rows.length > 0 ? result.rows[0].email : null;
  }

  private static transformNotification(row: NotificationRow): Notification {
    return {
      id: row.id,
      userId: row.user_id,
      projectId: row.project_id,
      type: row.type,
      message: row.message,
      isRead: row.is_read,
      createdAt: row.created_at,
      metadata: row.metadata
    };
  }
} 