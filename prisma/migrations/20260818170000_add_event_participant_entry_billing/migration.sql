-- Representa a entrada manual e o saldo cobrado pelo Asaas na mesma inscrição.
CREATE TYPE "EventParticipantBillingMode" AS ENUM ('FULL', 'INSTALLMENT', 'ENTRY_INSTALLMENT');

ALTER TABLE "EventParticipant"
ADD COLUMN "billingMode" "EventParticipantBillingMode" NOT NULL DEFAULT 'FULL',
ADD COLUMN "entryAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "balanceAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "entryPaymentMethod" TEXT;
