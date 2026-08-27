-- Fila de notificações internas: claim atômico e fencing token para workers concorrentes.
ALTER TYPE "PendingInboxNotificationStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';

ALTER TABLE "PendingInboxNotification"
  ADD COLUMN "processingToken" TEXT,
  ADD COLUMN "processingStartedAt" TIMESTAMP(3),
  ADD COLUMN "leaseUntil" TIMESTAMP(3);

CREATE INDEX "PendingInboxNotification_status_leaseUntil_idx"
  ON "PendingInboxNotification"("status", "leaseUntil");
