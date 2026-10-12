CREATE TYPE "EventTicketWhatsAppNotificationStatus" AS ENUM (
  'PENDING', 'PROCESSING', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'DLQ', 'SKIPPED'
);

CREATE TYPE "EventTicketWhatsAppPurchaseType" AS ENUM ('PUBLIC_ORDER', 'STAFF_SALE');

ALTER TABLE "EventMapOrder"
  ADD COLUMN "whatsappOptInAt" TIMESTAMP(3),
  ADD COLUMN "whatsappOptInSource" VARCHAR(32);

ALTER TABLE "EventTicketSale"
  ADD COLUMN "buyerPhone" VARCHAR(32),
  ADD COLUMN "whatsappOptInAt" TIMESTAMP(3),
  ADD COLUMN "whatsappOptInSource" VARCHAR(32);

CREATE TABLE "EventTicketWhatsAppNotification" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "purchaseType" "EventTicketWhatsAppPurchaseType" NOT NULL,
  "eventMapOrderId" TEXT,
  "eventTicketSaleId" TEXT,
  "status" "EventTicketWhatsAppNotificationStatus" NOT NULL DEFAULT 'PENDING',
  "templateName" TEXT NOT NULL,
  "languageCode" TEXT NOT NULL DEFAULT 'pt_BR',
  "recipientPhone" VARCHAR(32) NOT NULL,
  "consentVersion" TEXT,
  "consentSource" VARCHAR(32),
  "consentRecordedAt" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 8,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "lockedBy" TEXT,
  "lastErrorCode" TEXT,
  "lastError" TEXT,
  "correlationId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "whatsappJobId" TEXT,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EventTicketWhatsAppNotification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chk_event_ticket_whatsapp_purchase_reference" CHECK (
    ("purchaseType" = 'PUBLIC_ORDER' AND "eventMapOrderId" IS NOT NULL AND "eventTicketSaleId" IS NULL)
    OR ("purchaseType" = 'STAFF_SALE' AND "eventTicketSaleId" IS NOT NULL AND "eventMapOrderId" IS NULL)
  )
);

CREATE UNIQUE INDEX "uq_event_ticket_whatsapp_notification_idempotency"
  ON "EventTicketWhatsAppNotification"("idempotencyKey");
CREATE INDEX "idx_event_ticket_whatsapp_notification_retry"
  ON "EventTicketWhatsAppNotification"("contaId", "status", "nextAttemptAt");
CREATE INDEX "idx_event_ticket_whatsapp_notification_order"
  ON "EventTicketWhatsAppNotification"("contaId", "eventMapOrderId", "createdAt");
CREATE INDEX "idx_event_ticket_whatsapp_notification_sale"
  ON "EventTicketWhatsAppNotification"("contaId", "eventTicketSaleId", "createdAt");

ALTER TABLE "EventTicketWhatsAppNotification"
  ADD CONSTRAINT "EventTicketWhatsAppNotification_contaId_fkey"
    FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "EventTicketWhatsAppNotification_eventMapOrderId_fkey"
    FOREIGN KEY ("eventMapOrderId") REFERENCES "EventMapOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "EventTicketWhatsAppNotification_eventTicketSaleId_fkey"
    FOREIGN KEY ("eventTicketSaleId") REFERENCES "EventTicketSale"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EventTicketWhatsAppNotification" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "EventTicketWhatsAppNotification"
  USING ("contaId" = app_security.current_conta_id())
  WITH CHECK ("contaId" = app_security.current_conta_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alusa_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "EventTicketWhatsAppNotification" TO alusa_app;
  END IF;
END $$;
