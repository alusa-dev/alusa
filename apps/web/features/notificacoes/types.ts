export type NotificationSeverity = 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL';
export type NotificationCategory =
  | 'ENROLLMENT'
  | 'BILLING'
  | 'PAYMENT'
  | 'SYSTEM'
  | 'CONTRACT'
  | 'EXPERIMENTAL';

export type NotificationType =
  | 'ENROLLMENT_CREATED'
  | 'ENROLLMENT_RENEWED'
  | 'ENROLLMENT_PAUSED'
  | 'ENROLLMENT_RESUMED'
  | 'ENROLLMENT_CANCELLED'
  | 'BILLING_CREATED'
  | 'BILLING_OVERDUE'
  | 'BILLING_CANCELLED'
  | 'PAYMENT_CONFIRMED'
  | 'PAYMENT_REFUNDED'
  | 'CONTRACT_SIGNED'
  | 'CONTRACT_EXPIRING'
  | 'CONTRACT_EXPIRED'
  | 'CONTRACT_CANCELLED'
  | 'EXPERIMENTAL_SCHEDULED'
  | 'EXPERIMENTAL_RESCHEDULED'
  | 'EXPERIMENTAL_COMPLETED'
  | 'EXPERIMENTAL_CANCELLED'
  | 'SYSTEM_ATTENTION'
  | 'TRANSFER_DONE'
  | 'TRANSFER_FAILED'
  | 'TRANSFER_CANCELLED'
  | 'BALANCE_BLOCKED'
  | 'ACCESS_TOKEN_ALERT'
  | 'WEBHOOK_INTERRUPTED'
  | 'WEBHOOK_DLQ';

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
