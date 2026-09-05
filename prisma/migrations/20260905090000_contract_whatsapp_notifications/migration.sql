CREATE TYPE "ContractWhatsAppNotificationStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'DLQ', 'SKIPPED');

ALTER TABLE "Contrato" ADD COLUMN "tokenPublicoCriptografado" TEXT;

CREATE TABLE "ContractWhatsAppNotification" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "contratoId" TEXT NOT NULL,
    "matriculaId" TEXT NOT NULL,
    "status" "ContractWhatsAppNotificationStatus" NOT NULL DEFAULT 'PENDING',
    "templateName" TEXT NOT NULL,
    "languageCode" TEXT NOT NULL DEFAULT 'pt_BR',
    "recipientPhone" VARCHAR(32) NOT NULL,
    "recipientType" VARCHAR(32) NOT NULL,
    "tokenCriptografado" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastErrorCode" TEXT,
    "lastError" TEXT,
    "correlationId" TEXT,
    "whatsappJobId" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContractWhatsAppNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_contract_whatsapp_notification_dedupe"
  ON "ContractWhatsAppNotification"("contaId", "contratoId", "recipientPhone", "templateName");
CREATE INDEX "idx_contract_whatsapp_notification_status_retry"
  ON "ContractWhatsAppNotification"("contaId", "status", "nextAttemptAt");
CREATE INDEX "idx_contract_whatsapp_notification_contract"
  ON "ContractWhatsAppNotification"("contaId", "contratoId");

ALTER TABLE "ContractWhatsAppNotification"
  ADD CONSTRAINT "ContractWhatsAppNotification_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractWhatsAppNotification_contratoId_fkey"
  FOREIGN KEY ("contratoId") REFERENCES "Contrato"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractWhatsAppNotification_matriculaId_fkey"
  FOREIGN KEY ("matriculaId") REFERENCES "Matricula"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
