CREATE TABLE "AsaasNotificationSyncOutbox" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "asaasCustomerId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "requestedChannels" JSONB NOT NULL,
    "externalReference" TEXT,
    "correlationId" TEXT,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AsaasNotificationSyncOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_asaas_notification_sync_conta_dedupe" ON "AsaasNotificationSyncOutbox"("contaId", "dedupeKey");
CREATE INDEX "idx_asaas_notification_sync_status_next" ON "AsaasNotificationSyncOutbox"("status", "nextAttemptAt", "createdAt");
CREATE INDEX "idx_asaas_notification_sync_conta_status_next" ON "AsaasNotificationSyncOutbox"("contaId", "status", "nextAttemptAt");
CREATE INDEX "idx_asaas_notification_sync_conta_customer" ON "AsaasNotificationSyncOutbox"("contaId", "asaasCustomerId");
CREATE INDEX "idx_asaas_notification_sync_conta_correlation" ON "AsaasNotificationSyncOutbox"("contaId", "correlationId");

ALTER TABLE "AsaasNotificationSyncOutbox"
  ADD CONSTRAINT "AsaasNotificationSyncOutbox_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
