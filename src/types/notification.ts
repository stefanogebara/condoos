export type NotificationType = 
  | 'status_update' 
  | 'new_vote' 
  | 'new_comment' 
  | 'vote_threshold'
  | 'budget_update'
  | 'document_upload'
  | 'maintenance_schedule'
  | 'payment_reminder'
  | 'meeting_scheduled';

export interface NotificationTypeSettings {
  enabled: boolean;
  email: boolean;
  push: boolean;
}

export interface NotificationPreferences {
  userId: number;
  emailNotifications: boolean;
  pushNotifications: boolean;
  notificationTypes: {
    [K in NotificationType]: NotificationTypeSettings;
  };
}

export interface Notification {
  id: number;
  userId: number;
  projectId: number;
  type: NotificationType;
  message: string;
  isRead: boolean;
  createdAt: Date;
  metadata?: Record<string, any>;
}

export interface NotificationRow {
  id: number;
  user_id: number;
  project_id: number;
  type: NotificationType;
  message: string;
  is_read: boolean;
  created_at: Date;
  metadata?: Record<string, any>;
} 