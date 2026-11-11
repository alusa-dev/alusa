import { z } from 'zod';
import type { NotificationListResult } from './notification-types';

export const notificationFeedViewSchema = z.enum(['active', 'archived', 'all']);
export const notificationActionSchema = z.enum(['read', 'unread', 'archive', 'unarchive']);
export const notificationItemActionSchema = z.object({ action: notificationActionSchema }).strict();
export const notificationIdParamsSchema = z.object({ id: z.string().trim().min(1).max(191) });
export const notificationBulkActionSchema = z.object({ action: z.literal('markAllRead') }).strict();

export const notificationFeedItemResponseSchema = z.object({
  id: z.string(),
  type: z.string(),
  category: z.string(),
  severity: z.string(),
  title: z.string(),
  message: z.string(),
  relatedPath: z.string().nullable(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  sourceType: z.string().nullable(),
  sourceId: z.string().nullable(),
  metadata: z.unknown().nullable(),
  triggeredAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  readAt: z.string().datetime().nullable(),
  archivedAt: z.string().datetime().nullable(),
});

export const notificationFeedResponseSchema = z.object({
  items: z.array(notificationFeedItemResponseSchema),
  unreadCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
});

export const notificationUnreadCountResponseSchema = z.object({ count: z.number().int().nonnegative() });
export const notificationActionResponseSchema = z.object({ success: z.literal(true) });
export const notificationBulkActionResponseSchema = notificationActionResponseSchema.extend({
  updatedCount: z.number().int().nonnegative(),
});

export function notificationListQuerySchema(maxLimit: number, defaults = false) {
  const schema = z.object({
    limit: z.coerce.number().int().min(1).max(maxLimit),
    page: z.coerce.number().int().min(1),
    view: notificationFeedViewSchema,
  });
  return defaults
    ? schema.extend({ limit: z.coerce.number().int().min(1).max(maxLimit).default(20), page: z.coerce.number().int().min(1).default(1), view: notificationFeedViewSchema.default('active') })
    : schema.partial();
}

export function serializeNotificationFeed(result: NotificationListResult) {
  return notificationFeedResponseSchema.parse({
    items: result.items.map((item) => ({
      ...item,
      createdAt: item.createdAt.toISOString(),
      triggeredAt: item.triggeredAt.toISOString(),
      readAt: item.readAt?.toISOString() ?? null,
      archivedAt: item.archivedAt?.toISOString() ?? null,
    })),
    unreadCount: result.unreadCount,
    totalCount: result.totalCount,
  });
}
