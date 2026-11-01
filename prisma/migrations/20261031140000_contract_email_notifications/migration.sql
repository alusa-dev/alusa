ALTER TABLE "Conta"
  ADD COLUMN "contractNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "contractEmailNotificationsEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ContractWhatsAppNotification"
  ADD COLUMN "lastManualOperationId" TEXT;

CREATE TYPE "ContractEmailNotificationStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'DLQ', 'SKIPPED');

CREATE TABLE "ContractEmailNotification" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "contratoId" TEXT NOT NULL,
  "matriculaId" TEXT NOT NULL,
  "status" "ContractEmailNotificationStatus" NOT NULL DEFAULT 'PENDING',
  "recipientEmail" TEXT NOT NULL,
  "recipientName" TEXT NOT NULL,
  "tokenCriptografado" TEXT NOT NULL,
  "tokenPublicoHash" TEXT NOT NULL,
  "deliveryKey" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 8,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "lastErrorCode" TEXT,
  "lastError" TEXT,
  "providerEmailId" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContractEmailNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_contract_email_notification_delivery"
  ON "ContractEmailNotification"("contaId", "deliveryKey");
CREATE INDEX "idx_contract_email_notification_retry"
  ON "ContractEmailNotification"("contaId", "status", "nextAttemptAt");
CREATE INDEX "idx_contract_email_notification_contract"
  ON "ContractEmailNotification"("contaId", "contratoId", "createdAt");

ALTER TABLE "ContractEmailNotification"
  ADD CONSTRAINT "ContractEmailNotification_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractEmailNotification_contratoId_fkey"
  FOREIGN KEY ("contratoId") REFERENCES "Contrato"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractEmailNotification_matriculaId_fkey"
  FOREIGN KEY ("matriculaId") REFERENCES "Matricula"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContractEmailNotification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContractEmailNotification" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ContractEmailNotification_tenant_isolation"
  ON "ContractEmailNotification"
  USING ("contaId" = app_security.current_conta_id())
  WITH CHECK ("contaId" = app_security.current_conta_id());
