export type MobileNotificationSeverity = 'INFO' | 'SUCCESS' | 'WARNING' | 'CRITICAL' | string;

export type MobileNotificationItem = {
  id: string;
  type: string;
  category: string;
  severity: MobileNotificationSeverity;
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
};

export type MobileNotificationListResponse = {
  items: MobileNotificationItem[];
  unreadCount: number;
  totalCount: number;
};

export type MobileNotificationUnreadCountResponse = {
  count: number;
};

export type MobileNotificationAction = 'read' | 'unread' | 'archive' | 'unarchive';
