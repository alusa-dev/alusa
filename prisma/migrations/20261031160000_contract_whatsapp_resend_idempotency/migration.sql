CREATE UNIQUE INDEX "uq_contract_whatsapp_notification_tenant_id"
  ON "ContractWhatsAppNotification"("contaId", "id");

CREATE TABLE "ContractWhatsAppResendOperation" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "notificationId" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContractWhatsAppResendOperation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_contract_whatsapp_resend_operation"
  ON "ContractWhatsAppResendOperation"("contaId", "notificationId", "operationId");
CREATE INDEX "idx_contract_whatsapp_resend_operation_history"
  ON "ContractWhatsAppResendOperation"("contaId", "notificationId", "createdAt");

ALTER TABLE "ContractWhatsAppResendOperation"
  ADD CONSTRAINT "ContractWhatsAppResendOperation_contaId_fkey"
    FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "ContractWhatsAppResendOperation_notification_tenant_fkey"
    FOREIGN KEY ("contaId", "notificationId")
    REFERENCES "ContractWhatsAppNotification"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContractWhatsAppResendOperation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContractWhatsAppResendOperation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ContractWhatsAppResendOperation_tenant_isolation"
  ON "ContractWhatsAppResendOperation"
  USING ("contaId" = app_security.current_conta_id())
  WITH CHECK ("contaId" = app_security.current_conta_id());
