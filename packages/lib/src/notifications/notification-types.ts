import type { NotificationCategory, NotificationSeverity, NotificationType, AuditActorType, Role } from '@prisma/client';
import type { Prisma } from '@prisma/client';
export type { BillingNotificationEventInput, WebhookNotificationEvent } from './notification-events';

export type NotificationFeedView = 'active' | 'archived' | 'all';

export type BillingOriginContextInput = {
  originLabel?: string | null;
  description?: string | null;
  planId?: string | null;
  planBillingType?: string | null;
  planValue?: number | null;
  planInstallmentCount?: number | null;
  installmentPosition?: number | null;
};

export interface NotificationActor {
  type: AuditActorType;
  id?: string | null;
}

export interface CreateNotificationInput {
  contaId: string;
  type: NotificationType;
  category: NotificationCategory;
  severity?: NotificationSeverity;
  title: string;
  message: string;
  dedupeKey: string;
  relatedPath?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  metadata?: Prisma.InputJsonValue;
  actor?: NotificationActor;
  recipientUserIds?: string[];
  recipientRoles?: Role[];
  triggeredAt?: Date;
}

export interface NotificationListItem {
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
  metadata: Prisma.JsonValue | null;
  triggeredAt: Date;
  createdAt: Date;
  readAt: Date | null;
  archivedAt: Date | null;
}

export interface NotificationListResult {
  items: NotificationListItem[];
  unreadCount: number;
  totalCount: number;
}

export interface CreateNotificationResult {
  notificationId: string | null;
  created: boolean;
  recipientCount: number;
  reason?: 'policy_excluded' | 'no_recipients';
}

export type BillingWebhookNotificationResult = Omit<CreateNotificationResult, 'reason'> & {
  outcome: 'completed' | 'not_applicable' | 'entity_missing' | 'inconsistent';
  reason?: 'unsupported_event' | 'policy_excluded' | 'no_recipients' | 'event_ticket_payment' | 'event_order_sale_link_conflict' | 'entity_missing' | 'external_account_unlinked_payment' | 'external_origin_conflict' | 'notification_result_unclassified';
};

export type PublicEventTicketInboxDispatchResult = 'created' | 'skipped' | 'retry';
