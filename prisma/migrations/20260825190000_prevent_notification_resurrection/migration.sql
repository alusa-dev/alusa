ALTER TABLE "NotificationRecipient"
ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "idx_notification_recipient_deleted_feed"
ON "NotificationRecipient"("contaId", "userId", "deletedAt", "archivedAt", "createdAt");
