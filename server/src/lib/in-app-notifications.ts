import db from '../db';

export type NotificationPriority = 'low' | 'normal' | 'high' | 'urgent';
export type NotificationSource = 'system' | 'visitor' | 'package' | 'finance' | 'ticket' | 'proposal' | 'reservation' | 'concierge';

export interface InAppNotificationInput {
  condominium_id: number;
  user_id: number;
  source: NotificationSource;
  title: string;
  body?: string | null;
  href?: string | null;
  priority?: NotificationPriority;
  target_type?: string | null;
  target_id?: number | null;
}

export interface InAppNotification {
  id: number;
  condominium_id: number;
  user_id: number;
  source: NotificationSource;
  title: string;
  body: string | null;
  href: string | null;
  priority: NotificationPriority;
  target_type: string | null;
  target_id: number | null;
  status: 'unread' | 'read' | 'archived';
  created_at: string;
  read_at: string | null;
}

export function createInAppNotification(input: InAppNotificationInput): number {
  const row = db.prepare(
    `INSERT INTO in_app_notifications (
       condominium_id, user_id, source, title, body, href, priority, target_type, target_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    input.condominium_id,
    input.user_id,
    input.source,
    input.title,
    input.body || null,
    input.href || null,
    input.priority || 'normal',
    input.target_type || null,
    input.target_id || null,
  );
  return Number(row.lastInsertRowid);
}

export function listInAppNotifications(userId: number, limit = 20): InAppNotification[] {
  return db.prepare(
    `SELECT *
     FROM in_app_notifications
     WHERE user_id = ?
       AND status <> 'archived'
     ORDER BY status = 'unread' DESC, created_at DESC
     LIMIT ?`
  ).all(userId, limit) as InAppNotification[];
}

export function unreadInAppNotificationCount(userId: number): number {
  const row = db.prepare(
    `SELECT COUNT(*) AS count
     FROM in_app_notifications
     WHERE user_id = ?
       AND status = 'unread'`
  ).get(userId) as { count: number } | undefined;
  return Number(row?.count || 0);
}

export function markInAppNotificationRead(userId: number, id: number): InAppNotification | null {
  const found = db.prepare(
    `SELECT id FROM in_app_notifications WHERE id = ? AND user_id = ?`
  ).get(id, userId) as { id: number } | undefined;
  if (!found) return null;
  db.prepare(
    `UPDATE in_app_notifications
     SET status = 'read',
         read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
     WHERE id = ?`
  ).run(id);
  return db.prepare(
    `SELECT * FROM in_app_notifications WHERE id = ?`
  ).get(id) as InAppNotification;
}
