-- AlterEnum: Add PENDING_SYNC to ChargeStatus
ALTER TYPE "ChargeStatus" ADD VALUE IF NOT EXISTS 'PENDING_SYNC';

-- AlterEnum: Add WEBHOOK_INTERRUPTED and WEBHOOK_DLQ to NotificationType
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WEBHOOK_INTERRUPTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'WEBHOOK_DLQ';

-- AlterTable: Add nextRetryAt to WebhookAsaas
ALTER TABLE "WebhookAsaas" ADD COLUMN IF NOT EXISTS "nextRetryAt" TIMESTAMP(3);

-- AlterTable: Add nextRetryAt to WebhookAsaasArchive
ALTER TABLE "WebhookAsaasArchive" ADD COLUMN IF NOT EXISTS "nextRetryAt" TIMESTAMP(3);
