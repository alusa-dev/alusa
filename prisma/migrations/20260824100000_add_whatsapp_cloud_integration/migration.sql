-- Integração institucional da Alusa com a WhatsApp Cloud API.
-- A conexão PLATFORM não pertence a um tenant; mensagens relacionadas a uma
-- escola continuam carregando contaId para preservar isolamento e auditoria.

CREATE TYPE "WhatsAppConnectionScope" AS ENUM ('PLATFORM', 'TENANT');
CREATE TYPE "WhatsAppConnectionStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'ERROR');
CREATE TYPE "WhatsAppMessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "WhatsAppMessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');
CREATE TYPE "WhatsAppWebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'DLQ');
CREATE TYPE "WhatsAppOutboundJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'DLQ');

CREATE TABLE "WhatsAppConnection" (
    "id" TEXT NOT NULL,
    "scope" "WhatsAppConnectionScope" NOT NULL DEFAULT 'PLATFORM',
    "contaId" TEXT,
    "phoneNumberId" VARCHAR(64) NOT NULL,
    "wabaId" VARCHAR(64) NOT NULL,
    "displayPhoneNumber" TEXT,
    "verifiedName" TEXT,
    "status" "WhatsAppConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastHealthCheckAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppConnection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "contaId" TEXT,
    "direction" "WhatsAppMessageDirection" NOT NULL,
    "status" "WhatsAppMessageStatus" NOT NULL DEFAULT 'QUEUED',
    "externalMessageId" TEXT,
    "toPhoneNumber" VARCHAR(32),
    "fromPhoneNumber" VARCHAR(32),
    "messageType" VARCHAR(32) NOT NULL,
    "templateName" TEXT,
    "body" TEXT,
    "payload" JSONB NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsAppWebhookEvent" (
    "id" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "connectionId" TEXT,
    "contaId" TEXT,
    "topic" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadHash" VARCHAR(64) NOT NULL,
    "signatureValid" BOOLEAN NOT NULL DEFAULT false,
    "status" "WhatsAppWebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastErrorCode" TEXT,
    "lastError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsAppOutboundJob" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "contaId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "status" "WhatsAppOutboundJobStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastErrorCode" TEXT,
    "lastError" TEXT,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsAppOutboundJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_whatsapp_connection_scope_phone" ON "WhatsAppConnection"("scope", "phoneNumberId");
CREATE INDEX "idx_whatsapp_connection_conta_status" ON "WhatsAppConnection"("contaId", "status");
CREATE INDEX "WhatsAppConnection_wabaId_idx" ON "WhatsAppConnection"("wabaId");

CREATE UNIQUE INDEX "uq_whatsapp_message_connection_external" ON "WhatsAppMessage"("connectionId", "externalMessageId");
CREATE INDEX "idx_whatsapp_message_conta_created" ON "WhatsAppMessage"("contaId", "createdAt");
CREATE INDEX "idx_whatsapp_message_connection_status" ON "WhatsAppMessage"("connectionId", "status", "createdAt");
CREATE INDEX "WhatsAppMessage_correlationId_idx" ON "WhatsAppMessage"("correlationId");

CREATE UNIQUE INDEX "WhatsAppWebhookEvent_eventKey_key" ON "WhatsAppWebhookEvent"("eventKey");
CREATE INDEX "idx_whatsapp_webhook_status_retry" ON "WhatsAppWebhookEvent"("status", "nextRetryAt");
CREATE INDEX "idx_whatsapp_webhook_conta_status_retry" ON "WhatsAppWebhookEvent"("contaId", "status", "nextRetryAt");
CREATE INDEX "idx_whatsapp_webhook_connection_received" ON "WhatsAppWebhookEvent"("connectionId", "receivedAt");

CREATE UNIQUE INDEX "WhatsAppOutboundJob_messageId_key" ON "WhatsAppOutboundJob"("messageId");
CREATE UNIQUE INDEX "WhatsAppOutboundJob_idempotencyKey_key" ON "WhatsAppOutboundJob"("idempotencyKey");
CREATE INDEX "idx_whatsapp_outbound_status_retry" ON "WhatsAppOutboundJob"("status", "nextAttemptAt");
CREATE INDEX "idx_whatsapp_outbound_conta_status_retry" ON "WhatsAppOutboundJob"("contaId", "status", "nextAttemptAt");
CREATE INDEX "idx_whatsapp_outbound_connection_created" ON "WhatsAppOutboundJob"("connectionId", "createdAt");
CREATE INDEX "WhatsAppOutboundJob_correlationId_idx" ON "WhatsAppOutboundJob"("correlationId");

ALTER TABLE "WhatsAppConnection"
  ADD CONSTRAINT "WhatsAppConnection_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WhatsAppMessage"
  ADD CONSTRAINT "WhatsAppMessage_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "WhatsAppConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "WhatsAppMessage_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WhatsAppWebhookEvent"
  ADD CONSTRAINT "WhatsAppWebhookEvent_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "WhatsAppConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "WhatsAppWebhookEvent_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "WhatsAppOutboundJob"
  ADD CONSTRAINT "WhatsAppOutboundJob_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "WhatsAppMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "WhatsAppOutboundJob_connectionId_fkey"
  FOREIGN KEY ("connectionId") REFERENCES "WhatsAppConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "WhatsAppOutboundJob_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE SET NULL ON UPDATE CASCADE;
