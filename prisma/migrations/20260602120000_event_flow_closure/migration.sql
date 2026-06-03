-- Event operational flow closure: public order payment lifecycle, partial refunds and participant snapshots.

ALTER TYPE "EventMapOrderStatus" ADD VALUE IF NOT EXISTS 'PAYMENT_PENDING';
ALTER TYPE "EventMapOrderStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';
ALTER TYPE "EventMapOrderStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_REFUNDED';

ALTER TYPE "EventFinancialEntryStatus" ADD VALUE IF NOT EXISTS 'PARTIALLY_REFUNDED';

ALTER TABLE "EventMapOrder"
  ADD COLUMN IF NOT EXISTS "paymentProvider" TEXT,
  ADD COLUMN IF NOT EXISTS "asaasCustomerId" TEXT,
  ADD COLUMN IF NOT EXISTS "asaasPaymentId" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentStatus" TEXT,
  ADD COLUMN IF NOT EXISTS "invoiceUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "refundedAmount" DECIMAL(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE "EventMapOrder"
  ALTER COLUMN "confirmedAt" DROP NOT NULL;

ALTER TABLE "EventTicketSale"
  ADD COLUMN IF NOT EXISTS "eventMapOrderId" TEXT,
  ADD COLUMN IF NOT EXISTS "refundedAmount" DECIMAL(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE "EventFinancialEntry"
  ADD COLUMN IF NOT EXISTS "refundedAmount" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "netAmount" DECIMAL(12, 2);

ALTER TABLE "EventParticipant"
  ADD COLUMN IF NOT EXISTS "financialStatusSnapshot" TEXT,
  ADD COLUMN IF NOT EXISTS "feePaidAmount" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "feeRefundedAmount" DECIMAL(12, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancelledReason" TEXT;

CREATE INDEX IF NOT EXISTS "idx_event_map_order_conta_asaas_payment"
  ON "EventMapOrder"("contaId", "asaasPaymentId");

CREATE INDEX IF NOT EXISTS "idx_event_map_order_conta_expires_status"
  ON "EventMapOrder"("contaId", "expiresAt", "status");

CREATE INDEX IF NOT EXISTS "idx_event_ticket_sale_conta_map_order"
  ON "EventTicketSale"("contaId", "eventMapOrderId");
