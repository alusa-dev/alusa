-- Expand internal notification types and categories
ALTER TYPE "NotificationCategory" ADD VALUE IF NOT EXISTS 'CONTRACT';
ALTER TYPE "NotificationCategory" ADD VALUE IF NOT EXISTS 'EXPERIMENTAL';

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ENROLLMENT_RENEWED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ENROLLMENT_PAUSED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ENROLLMENT_RESUMED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ENROLLMENT_CANCELLED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CONTRACT_SIGNED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CONTRACT_EXPIRING';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CONTRACT_EXPIRED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'CONTRACT_CANCELLED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'EXPERIMENTAL_SCHEDULED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'EXPERIMENTAL_RESCHEDULED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'EXPERIMENTAL_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'EXPERIMENTAL_CANCELLED';

-- Pending inbox retry queue
CREATE TYPE "PendingInboxNotificationStatus" AS ENUM ('PENDING', 'DONE', 'FAILED');

CREATE TABLE "PendingInboxNotification" (
    "id" TEXT NOT NULL,
    "contaId" TEXT,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" "PendingInboxNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "PendingInboxNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PendingInboxNotification_dedupeKey_key" ON "PendingInboxNotification"("dedupeKey");
CREATE INDEX "PendingInboxNotification_status_nextRetryAt_idx" ON "PendingInboxNotification"("status", "nextRetryAt");
CREATE INDEX "PendingInboxNotification_contaId_status_nextRetryAt_idx" ON "PendingInboxNotification"("contaId", "status", "nextRetryAt");
