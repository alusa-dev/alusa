CREATE TYPE "EventFinancialPaymentStatus" AS ENUM ('RECEIVED', 'REFUNDED');

CREATE TABLE "EventFinancialPayment" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "financialEntryId" TEXT NOT NULL,
    "participantId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "paymentMethod" "EventPaymentMethod" NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "status" "EventFinancialPaymentStatus" NOT NULL DEFAULT 'RECEIVED',
    "refundedAt" TIMESTAMP(3),
    "refundedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(12,2) NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventFinancialPayment_pkey" PRIMARY KEY ("id")
);

INSERT INTO "EventFinancialPayment" (
    "id", "contaId", "eventId", "financialEntryId", "participantId", "amount",
    "paymentMethod", "paidAt", "status", "refundedAmount", "netAmount", "createdAt", "updatedAt"
)
SELECT
    'legacy-payment-' || efe."id",
    efe."contaId",
    efe."eventId",
    efe."id",
    ep."id",
    efe."actualAmount",
    COALESCE(efe."paymentMethod", 'OTHER'::"EventPaymentMethod"),
    COALESCE(efe."realizedAt", efe."createdAt"),
    CASE WHEN efe."status" = 'REFUNDED' THEN 'REFUNDED'::"EventFinancialPaymentStatus" ELSE 'RECEIVED'::"EventFinancialPaymentStatus" END,
    CASE WHEN efe."status" = 'REFUNDED' THEN efe."refundedAmount" ELSE 0 END,
    CASE WHEN efe."status" = 'REFUNDED' THEN GREATEST(efe."actualAmount" - efe."refundedAmount", 0) ELSE efe."actualAmount" END,
    efe."createdAt",
    efe."updatedAt"
FROM "EventFinancialEntry" efe
LEFT JOIN "EventParticipant" ep ON ep."revenueEntryId" = efe."id" AND ep."contaId" = efe."contaId"
WHERE efe."actualAmount" IS NOT NULL
  AND efe."actualAmount" > 0
  AND efe."asaasPaymentId" IS NULL
  AND efe."paymentProvider" IS DISTINCT FROM 'ASAAS';

ALTER TABLE "EventFinancialPayment" ADD CONSTRAINT "EventFinancialPayment_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventFinancialPayment" ADD CONSTRAINT "EventFinancialPayment_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "SchoolEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventFinancialPayment" ADD CONSTRAINT "EventFinancialPayment_financialEntryId_fkey"
  FOREIGN KEY ("financialEntryId") REFERENCES "EventFinancialEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventFinancialPayment" ADD CONSTRAINT "EventFinancialPayment_participantId_fkey"
  FOREIGN KEY ("participantId") REFERENCES "EventParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EventFinancialPayment" ADD CONSTRAINT "EventFinancialPayment_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "idx_event_financial_payment_entry_status" ON "EventFinancialPayment"("contaId", "financialEntryId", "status");
CREATE INDEX "idx_event_financial_payment_participant_status" ON "EventFinancialPayment"("contaId", "participantId", "status");
CREATE INDEX "idx_event_financial_payment_event_paid" ON "EventFinancialPayment"("contaId", "eventId", "paidAt");
