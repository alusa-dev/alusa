-- Phase 1/3/5 scalability foundations:
-- - Composite indexes for critical reads
-- - ChargeReadModel projection table
-- - WebhookAsaasArchive table for retention lifecycle

-- Composite indexes (read-path tuning)
CREATE INDEX "idx_charge_conta_status_due" ON "Charge"("contaId", "status", "dueDate");
CREATE INDEX "idx_charge_conta_plan_due" ON "Charge"("contaId", "standaloneInstallmentPlanId", "dueDate");
CREATE INDEX "idx_charge_conta_created" ON "Charge"("contaId", "createdAt");

CREATE INDEX "idx_webhookasaas_conta_status_recebido" ON "WebhookAsaas"("contaId", "status", "recebidoEm");
CREATE INDEX "idx_webhookasaas_conta_evento_recebido" ON "WebhookAsaas"("contaId", "evento", "recebidoEm");

CREATE INDEX "idx_subscription_conta_status_created" ON "Subscription"("contaId", "status", "createdAt");
CREATE INDEX "idx_installmentplan_conta_status_due" ON "InstallmentPlan"("contaId", "status", "firstDueDate");
CREATE INDEX "idx_standalone_installment_conta_status_due" ON "StandaloneInstallmentPlan"("contaId", "status", "firstDueDate");

-- Projection table (read model)
CREATE TABLE "ChargeReadModel" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "sourceKind" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "origin" TEXT NOT NULL,
  "chargeType" TEXT NOT NULL,
  "linkStatus" TEXT NOT NULL DEFAULT 'LINKED',
  "groupId" TEXT,
  "description" TEXT,
  "payerName" TEXT NOT NULL,
  "value" DECIMAL(12,2) NOT NULL,
  "dueDate" TIMESTAMP(3),
  "billingType" TEXT,
  "status" TEXT NOT NULL,
  "asaasPaymentId" TEXT,
  "matriculaId" TEXT,
  "alunoId" TEXT,
  "tipo" TEXT,
  "isGroup" BOOLEAN NOT NULL DEFAULT false,
  "installmentCount" INTEGER,
  "installmentsPaid" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "projectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChargeReadModel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_charge_read_model_source" ON "ChargeReadModel"("contaId", "sourceKind", "sourceId");
CREATE INDEX "idx_charge_read_model_conta" ON "ChargeReadModel"("contaId");
CREATE INDEX "idx_charge_read_model_conta_status_due" ON "ChargeReadModel"("contaId", "status", "dueDate");
CREATE INDEX "idx_charge_read_model_conta_type_created" ON "ChargeReadModel"("contaId", "chargeType", "createdAt");
CREATE INDEX "idx_charge_read_model_conta_group" ON "ChargeReadModel"("contaId", "groupId");
CREATE INDEX "idx_charge_read_model_asaas_payment" ON "ChargeReadModel"("asaasPaymentId");

ALTER TABLE "ChargeReadModel"
  ADD CONSTRAINT "ChargeReadModel_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Archive table for webhook lifecycle retention
CREATE TABLE "WebhookAsaasArchive" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "evento" TEXT NOT NULL,
  "eventId" TEXT,
  "payloadHash" TEXT,
  "payload" JSONB NOT NULL,
  "recebidoEm" TIMESTAMP(3) NOT NULL,
  "processadoEm" TIMESTAMP(3),
  "status" TEXT NOT NULL,
  "asaasPaymentId" TEXT,
  "asaasSubscriptionId" TEXT,
  "asaasTransferId" TEXT,
  "tentativas" INTEGER NOT NULL,
  "ultimaTentativaEm" TIMESTAMP(3),
  "duracaoMs" INTEGER,
  "ultimoErro" TEXT,
  "attemptsLog" JSONB,
  "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WebhookAsaasArchive_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_webhookasaas_archive_conta" ON "WebhookAsaasArchive"("contaId");
CREATE INDEX "idx_webhookasaas_archive_conta_recebido" ON "WebhookAsaasArchive"("contaId", "recebidoEm");
CREATE INDEX "idx_webhookasaas_archive_status" ON "WebhookAsaasArchive"("status");
CREATE INDEX "idx_webhookasaas_archive_event_id" ON "WebhookAsaasArchive"("eventId");
CREATE INDEX "idx_webhookasaas_archive_payload_hash" ON "WebhookAsaasArchive"("payloadHash");
CREATE INDEX "idx_webhookasaas_archive_archived_at" ON "WebhookAsaasArchive"("archivedAt");

ALTER TABLE "WebhookAsaasArchive"
  ADD CONSTRAINT "WebhookAsaasArchive_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
