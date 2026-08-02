-- Expansão compatível do fluxo de matrícula familiar.
-- O status legado de MatriculaFamiliar é mantido durante a transição.

CREATE TYPE "FamilyAcademicStatus" AS ENUM ('PENDENTE', 'COMPLETO', 'PARCIAL', 'FALHO', 'CANCELADO');
CREATE TYPE "FamilyAllocationMethod" AS ENUM ('EQUAL_SPLIT', 'PRODUCT_PROPORTIONAL', 'MANUAL');
CREATE TYPE "FamilyEnrollmentOperationStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'PARTIAL',
  'FAILED',
  'REQUIRES_RECONCILIATION',
  'CANCELLED'
);

ALTER TABLE "MatriculaFamiliar"
  ADD COLUMN "academicStatus" "FamilyAcademicStatus" NOT NULL DEFAULT 'PENDENTE',
  ADD COLUMN "billingProvisionStatus" "MatriculaBillingProvisionStatus" NOT NULL DEFAULT 'PENDENTE',
  ADD COLUMN "billingVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "FamilyBillingOutbox"
  ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "uq_matricula_familiar_conta_id"
  ON "MatriculaFamiliar"("contaId", "id");
CREATE UNIQUE INDEX "uq_charge_conta_id"
  ON "Charge"("contaId", "id");

-- Conserva somente um lease ativo por família. Os demais exigem reconciliação,
-- pois podem ter produzido efeito remoto antes desta migração.
WITH ranked_processing AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "matriculaFamiliarId"
    ORDER BY "lockedAt" DESC NULLS LAST, "createdAt" DESC
  ) AS row_number
  FROM "FamilyBillingOutbox"
  WHERE "status" = 'PROCESSING' AND "matriculaFamiliarId" IS NOT NULL
)
UPDATE "FamilyBillingOutbox" outbox
SET
  "status" = 'REQUIRES_RECONCILIATION',
  "lastError" = 'LEASE_DUPLICADA_IDENTIFICADA_NA_MIGRACAO',
  "lockedAt" = NULL,
  "leaseExpiresAt" = NULL
FROM ranked_processing ranked
WHERE outbox."id" = ranked."id" AND ranked.row_number > 1;

CREATE UNIQUE INDEX "uq_family_outbox_processing_per_family"
  ON "FamilyBillingOutbox"("matriculaFamiliarId")
  WHERE "status" = 'PROCESSING' AND "matriculaFamiliarId" IS NOT NULL;

CREATE TABLE "FamilyEnrollmentOperation" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "familyGroupId" TEXT NOT NULL,
  "uiRequestId" TEXT NOT NULL,
  "strategy" TEXT NOT NULL,
  "status" "FamilyEnrollmentOperationStatus" NOT NULL DEFAULT 'PENDING',
  "previewHash" TEXT NOT NULL,
  "sourceVersion" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "expectedBillingVersion" INTEGER NOT NULL,
  "previousMonthlyAmount" DECIMAL(12,2) NOT NULL,
  "addedMonthlyAmount" DECIMAL(12,2) NOT NULL,
  "resultingMonthlyAmount" DECIMAL(12,2) NOT NULL,
  "enrollmentFeeAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "result" JSONB,
  "lastError" TEXT,
  "actorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "FamilyEnrollmentOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FamilyEnrollmentOperation_contaId_fkey"
    FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FamilyEnrollmentOperation_familyGroupId_fkey"
    FOREIGN KEY ("contaId", "familyGroupId") REFERENCES "MatriculaFamiliar"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uq_family_enrollment_operation_request"
  ON "FamilyEnrollmentOperation"("contaId", "uiRequestId");
CREATE UNIQUE INDEX "uq_family_enrollment_operation_conta_id"
  ON "FamilyEnrollmentOperation"("contaId", "id");
CREATE INDEX "idx_family_enrollment_operation_group_status"
  ON "FamilyEnrollmentOperation"("contaId", "familyGroupId", "status", "createdAt");
CREATE UNIQUE INDEX "uq_family_enrollment_operation_active"
  ON "FamilyEnrollmentOperation"("contaId", "familyGroupId")
  WHERE "status" IN ('PENDING', 'PROCESSING', 'FAILED', 'REQUIRES_RECONCILIATION');

ALTER TABLE "FamilyFinancialAllocation"
  ADD COLUMN "familyEnrollmentOperationId" TEXT,
  ADD COLUMN "sourceChargeId" TEXT,
  ADD COLUMN "allocationMethod" "FamilyAllocationMethod" NOT NULL DEFAULT 'EQUAL_SPLIT',
  ADD COLUMN "weight" DECIMAL(12,4),
  ADD CONSTRAINT "FamilyFinancialAllocation_familyEnrollmentOperationId_fkey"
    FOREIGN KEY ("contaId", "familyEnrollmentOperationId") REFERENCES "FamilyEnrollmentOperation"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "idx_family_fin_alloc_conta_source_charge"
  ON "FamilyFinancialAllocation"("contaId", "sourceChargeId");
CREATE INDEX "idx_family_fin_alloc_conta_operation"
  ON "FamilyFinancialAllocation"("contaId", "familyEnrollmentOperationId");
CREATE UNIQUE INDEX "uq_family_fin_alloc_operation_item"
  ON "FamilyFinancialAllocation"("contaId", "familyEnrollmentOperationId", "matriculaId", "chargeKind");

-- Migração semântica: ATIVO legado significava provisionado, nunca pago.
UPDATE "MatriculaFamiliar" family
SET
  "academicStatus" = CASE
    WHEN family."status" = 'CANCELADO' THEN 'CANCELADO'::"FamilyAcademicStatus"
    WHEN (SELECT COUNT(*) FROM "MatriculaFamiliarItem" item WHERE item."matriculaFamiliarId" = family."id") >= 2
      THEN 'COMPLETO'::"FamilyAcademicStatus"
    WHEN (SELECT COUNT(*) FROM "MatriculaFamiliarItem" item WHERE item."matriculaFamiliarId" = family."id") = 1
      THEN 'PARCIAL'::"FamilyAcademicStatus"
    WHEN family."status" = 'FALHO' THEN 'FALHO'::"FamilyAcademicStatus"
    ELSE 'PENDENTE'::"FamilyAcademicStatus"
  END,
  "billingProvisionStatus" = CASE
    WHEN family."status" = 'ATIVO' THEN 'PROVISIONADO'::"MatriculaBillingProvisionStatus"
    WHEN family."status" = 'PROCESSANDO' THEN 'PROCESSANDO'::"MatriculaBillingProvisionStatus"
    WHEN family."status" = 'FALHO' THEN 'FALHO'::"MatriculaBillingProvisionStatus"
    WHEN family."status" = 'CANCELADO' THEN 'CANCELADO'::"MatriculaBillingProvisionStatus"
    WHEN family."status" = 'PARCIAL' THEN 'PARCIAL'::"MatriculaBillingProvisionStatus"
    ELSE 'PENDENTE'::"MatriculaBillingProvisionStatus"
  END;

UPDATE "FamilyFinancialAllocation" allocation
SET "sourceChargeId" = family."standaloneEnrollmentChargeId"
FROM "MatriculaFamiliar" family
WHERE allocation."contaId" = family."contaId"
  AND allocation."familyGroupId" = family."id"
  AND allocation."chargeKind" = 'TAXA_MATRICULA'
  AND allocation."sourceChargeId" IS NULL
  AND family."standaloneEnrollmentChargeId" IS NOT NULL;

ALTER TABLE "FamilyFinancialAllocation"
  ADD CONSTRAINT "FamilyFinancialAllocation_sourceChargeId_fkey"
    FOREIGN KEY ("contaId", "sourceChargeId") REFERENCES "Charge"("contaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
    NOT VALID;

-- As duas tabelas são tenant-scoped e precisam da mesma política do restante do ERP.
ALTER TABLE "FamilyFinancialAllocation" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FamilyFinancialAllocation";
CREATE POLICY tenant_isolation ON "FamilyFinancialAllocation"
  USING ("contaId" = app_security.current_conta_id())
  WITH CHECK ("contaId" = app_security.current_conta_id());

ALTER TABLE "FamilyEnrollmentOperation" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "FamilyEnrollmentOperation"
  USING ("contaId" = app_security.current_conta_id())
  WITH CHECK ("contaId" = app_security.current_conta_id());

ALTER TABLE "FamilyFinancialAllocation"
  VALIDATE CONSTRAINT "FamilyFinancialAllocation_sourceChargeId_fkey";
