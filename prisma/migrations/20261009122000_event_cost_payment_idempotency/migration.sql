ALTER TABLE "EventFinancialPayment" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "uq_event_financial_payment_conta_idempotency"
  ON "EventFinancialPayment"("contaId", "idempotencyKey");
