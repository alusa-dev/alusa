-- Permite consolidar as taxas de vários participantes do mesmo responsável
-- em uma única cobrança do evento, sem alterar inscrições individuais.
CREATE TYPE "EventBillingGroupStatus" AS ENUM (
  'PENDING',
  'OPEN',
  'PARTIALLY_PAID',
  'PAID',
  'CANCELLED',
  'FAILED',
  'REQUIRES_RECONCILIATION'
);

CREATE TABLE "EventBillingGroup" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "responsavelId" TEXT NOT NULL,
  "status" "EventBillingGroupStatus" NOT NULL DEFAULT 'PENDING',
  "billingMode" "EventParticipantBillingMode" NOT NULL DEFAULT 'FULL',
  "totalAmount" DECIMAL(12,2) NOT NULL,
  "entryAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "balanceAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "entryPaymentMethod" TEXT,
  "billingMethod" TEXT,
  "chargeType" TEXT,
  "installmentCount" INTEGER,
  "dueDate" TIMESTAMP(3),
  "standaloneChargeId" TEXT,
  "asaasPaymentId" TEXT,
  "asaasInstallmentId" TEXT,
  "uiRequestId" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EventBillingGroup_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "EventParticipant"
ADD COLUMN "billingGroupId" TEXT;

CREATE UNIQUE INDEX "uq_event_billing_group_conta_id"
  ON "EventBillingGroup"("contaId", "id");
CREATE UNIQUE INDEX "uq_event_billing_group_conta_request"
  ON "EventBillingGroup"("contaId", "uiRequestId");
CREATE INDEX "idx_event_billing_group_conta_event_status"
  ON "EventBillingGroup"("contaId", "eventId", "status");
CREATE INDEX "idx_event_billing_group_conta_responsavel_status"
  ON "EventBillingGroup"("contaId", "responsavelId", "status");
CREATE INDEX "idx_event_billing_group_conta_charge"
  ON "EventBillingGroup"("contaId", "standaloneChargeId");
CREATE INDEX "idx_event_billing_group_conta_asaas_payment"
  ON "EventBillingGroup"("contaId", "asaasPaymentId");
CREATE INDEX "idx_event_billing_group_conta_asaas_installment"
  ON "EventBillingGroup"("contaId", "asaasInstallmentId");
CREATE INDEX "idx_event_participant_conta_billing_group"
  ON "EventParticipant"("contaId", "billingGroupId");

ALTER TABLE "EventBillingGroup"
  ADD CONSTRAINT "EventBillingGroup_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventBillingGroup_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "SchoolEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventBillingGroup_responsavelId_fkey"
  FOREIGN KEY ("responsavelId") REFERENCES "Responsavel"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "EventBillingGroup_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EventParticipant"
  ADD CONSTRAINT "EventParticipant_billingGroup_fkey"
  FOREIGN KEY ("contaId", "billingGroupId")
  REFERENCES "EventBillingGroup"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
