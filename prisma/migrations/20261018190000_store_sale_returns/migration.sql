CREATE TYPE "SaleReturnRefundStatus" AS ENUM (
  'NOT_REQUESTED', 'MANUAL_REFUND_REQUIRED', 'REQUESTED', 'IN_PROGRESS', 'AWAITING_PAYER_ACTION',
  'PARTIALLY_REFUNDED', 'REFUNDED', 'DENIED', 'NEEDS_RECONCILIATION', 'NOT_SUPPORTED'
);

CREATE TYPE "StoreSaleRefundAttemptStatus" AS ENUM (
  'REQUESTED', 'IN_PROGRESS', 'AWAITING_PAYER_ACTION', 'PARTIALLY_REFUNDED',
  'REFUNDED', 'DENIED', 'NEEDS_RECONCILIATION', 'NOT_SUPPORTED'
);

CREATE UNIQUE INDEX "uq_sale_conta_id" ON "Sale"("contaId", "id");
CREATE UNIQUE INDEX "uq_sale_item_sale_id" ON "SaleItem"("saleId", "id");
ALTER TABLE "Sale" ADD COLUMN "chargeConfigSnapshot" JSONB;

CREATE TABLE "StoreSaleReturn" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "refundStatus" "SaleReturnRefundStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
  "refundRequestedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "refundedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "refundRequestUrl" TEXT,
  "refundIssue" TEXT,
  "reason" TEXT,
  "createdById" TEXT,
  "refundedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StoreSaleReturn_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chk_store_sale_return_refund_amounts" CHECK ("refundRequestedAmount" >= 0 AND "refundedAmount" >= 0)
);

CREATE TABLE "StoreSaleReturnItem" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "saleId" TEXT NOT NULL,
  "returnId" TEXT NOT NULL,
  "saleItemId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "refundAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StoreSaleReturnItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chk_store_sale_return_item_quantity" CHECK ("quantity" > 0),
  CONSTRAINT "chk_store_sale_return_item_refund_amount" CHECK ("refundAmount" >= 0)
);

CREATE TABLE "StoreSaleRefundAttempt" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "returnId" TEXT NOT NULL,
  "chargeId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "status" "StoreSaleRefundAttemptStatus" NOT NULL DEFAULT 'REQUESTED',
  "requestedAmount" DECIMAL(12,2) NOT NULL,
  "providerRefundBaseline" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "confirmedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "requestUrl" TEXT,
  "providerStatus" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StoreSaleRefundAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chk_store_sale_refund_attempt_amounts" CHECK ("requestedAmount" > 0 AND "confirmedAmount" >= 0 AND "confirmedAmount" <= "requestedAmount")
);

CREATE UNIQUE INDEX "uq_store_sale_return_conta_id" ON "StoreSaleReturn"("contaId", "id");
CREATE UNIQUE INDEX "uq_store_sale_return_sale_id" ON "StoreSaleReturn"("saleId", "id");
CREATE UNIQUE INDEX "uq_store_sale_return_tenant_sale_id" ON "StoreSaleReturn"("contaId", "saleId", "id");
CREATE UNIQUE INDEX "uq_store_sale_return_conta_request" ON "StoreSaleReturn"("contaId", "requestId");
CREATE INDEX "idx_store_sale_return_conta_sale_created" ON "StoreSaleReturn"("contaId", "saleId", "createdAt");
CREATE INDEX "idx_store_sale_return_conta_refund_status" ON "StoreSaleReturn"("contaId", "refundStatus", "updatedAt");
CREATE UNIQUE INDEX "uq_store_sale_return_item_return_item" ON "StoreSaleReturnItem"("returnId", "saleItemId");
CREATE INDEX "idx_store_sale_return_item_conta_sale_item" ON "StoreSaleReturnItem"("contaId", "saleItemId");
CREATE UNIQUE INDEX "uq_store_sale_refund_attempt_conta_key" ON "StoreSaleRefundAttempt"("contaId", "idempotencyKey");
CREATE UNIQUE INDEX "uq_store_sale_refund_attempt_conta_correlation" ON "StoreSaleRefundAttempt"("contaId", "correlationId");
CREATE INDEX "idx_store_sale_refund_attempt_conta_return_status" ON "StoreSaleRefundAttempt"("contaId", "returnId", "status");
CREATE INDEX "idx_store_sale_refund_attempt_conta_charge_status" ON "StoreSaleRefundAttempt"("contaId", "chargeId", "status");

ALTER TABLE "StoreSaleReturn"
  ADD CONSTRAINT "StoreSaleReturn_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "StoreSaleReturn_sale_conta_fkey" FOREIGN KEY ("contaId", "saleId") REFERENCES "Sale"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "StoreSaleReturn_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StoreSaleReturnItem"
  ADD CONSTRAINT "StoreSaleReturnItem_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "StoreSaleReturnItem_return_sale_fkey" FOREIGN KEY ("contaId", "saleId", "returnId") REFERENCES "StoreSaleReturn"("contaId", "saleId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "StoreSaleReturnItem_saleItemId_fkey" FOREIGN KEY ("saleId", "saleItemId") REFERENCES "SaleItem"("saleId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StoreSaleRefundAttempt"
  ADD CONSTRAINT "StoreSaleRefundAttempt_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "StoreSaleRefundAttempt_return_conta_fkey" FOREIGN KEY ("contaId", "returnId") REFERENCES "StoreSaleReturn"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "StoreSaleRefundAttempt_charge_conta_fkey" FOREIGN KEY ("contaId", "chargeId") REFERENCES "Charge"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StoreSaleReturn" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StoreSaleReturnItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StoreSaleRefundAttempt" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "StoreSaleReturn" USING ("contaId" = app_security.current_conta_id()) WITH CHECK ("contaId" = app_security.current_conta_id());
CREATE POLICY tenant_isolation ON "StoreSaleReturnItem" USING ("contaId" = app_security.current_conta_id()) WITH CHECK ("contaId" = app_security.current_conta_id());
CREATE POLICY tenant_isolation ON "StoreSaleRefundAttempt" USING ("contaId" = app_security.current_conta_id()) WITH CHECK ("contaId" = app_security.current_conta_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'alusa_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "StoreSaleReturn", "StoreSaleReturnItem", "StoreSaleRefundAttempt" TO alusa_app;
  END IF;
END $$;
