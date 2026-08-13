-- Supports the tenant/user-scoped unread counter and chronological inbox feed.
CREATE INDEX "idx_notification_recipient_unread_feed"
ON "NotificationRecipient"("contaId", "userId", "archivedAt", "readAt", "createdAt");
