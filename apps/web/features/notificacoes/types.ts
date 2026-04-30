export type NotificationSeverity = 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';
export type NotificationCategory = 'ENROLLMENT' | 'BILLING' | 'PAYMENT' | 'SYSTEM';
export type NotificationType =
  | 'ENROLLMENT_CREATED'
  | 'BILLING_CREATED'
  | 'BILLING_OVERDUE'
  | 'BILLING_CANCELLED'
  | 'PAYMENT_CONFIRMED'
  | 'PAYMENT_REFUNDED'
  | 'SYSTEM_ATTENTION';

export type NotificationView = 'active' | 'archived' | 'all';
export type NotificationAction = 'read' | 'unread' | 'archive' | 'unarchive';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  category: NotificationCategory;
  severity: NotificationSeverity;
  title: string;
  message: string;
  relatedPath: string | null;
  entityType: string | null;
  entityId: string | null;
  sourceType: string | null;
  sourceId: string | null;
  metadata: unknown;
  createdAt: string;
  triggeredAt: string;
  readAt: string | null;
  archivedAt: string | null;
}

export interface NotificationListResponse {
  items: NotificationItem[];
  unreadCount: number;
  totalCount: number;
}
