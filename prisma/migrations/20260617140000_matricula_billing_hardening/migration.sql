-- Matrícula billing hardening: idempotency, provision status, outbox dedupe

CREATE TYPE "MatriculaBillingProvisionStatus" AS ENUM (
  'NAO_APLICAVEL',
  'PENDENTE',
  'PROCESSANDO',
  'PROVISIONADO',
  'PARCIAL',
  'FALHO',
  'CANCELADO'
);

ALTER TABLE "Matricula"
  ADD COLUMN "uiRequestId" TEXT,
  ADD COLUMN "billingProvisionStatus" "MatriculaBillingProvisionStatus",
  ADD COLUMN "billingProvisionError" TEXT,
  ADD COLUMN "billingProvisionAt" TIMESTAMP(3),
  ADD COLUMN "pendingAsaasSubscriptionId" TEXT;

UPDATE "Matricula" m
SET "billingProvisionStatus" = 'NAO_APLICAVEL'
WHERE m."billingMode" = 'SHARED_PLAN'
   OR m."matriculaFamiliarId" IS NOT NULL;

UPDATE "Matricula" m
SET "billingProvisionStatus" = CASE
  WHEN m."asaasSubscriptionId" IS NOT NULL OR EXISTS (
    SELECT 1 FROM "Cobranca" c WHERE c."matriculaId" = m.id
  ) THEN 'PROVISIONADO'::"MatriculaBillingProvisionStatus"
  WHEN m."integrationStatus" = 'PENDENTE_SINCRONISMO' THEN 'PROCESSANDO'::"MatriculaBillingProvisionStatus"
  ELSE 'PENDENTE'::"MatriculaBillingProvisionStatus"
END
WHERE m."billingProvisionStatus" IS NULL;

ALTER TABLE "Matricula"
  ALTER COLUMN "billingProvisionStatus" SET DEFAULT 'PENDENTE',
  ALTER COLUMN "billingProvisionStatus" SET NOT NULL;

CREATE UNIQUE INDEX "uq_matricula_conta_request"
  ON "Matricula"("contaId", "uiRequestId");

CREATE INDEX "idx_matricula_conta_billing_provision"
  ON "Matricula"("contaId", "billingProvisionStatus");

ALTER TABLE "FamilyBillingOutbox"
  ADD COLUMN "dedupeKey" TEXT;

CREATE UNIQUE INDEX "uq_family_billing_outbox_dedupe"
  ON "FamilyBillingOutbox"("contaId", "dedupeKey");
