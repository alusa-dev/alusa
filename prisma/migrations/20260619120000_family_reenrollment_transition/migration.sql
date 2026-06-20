-- Family reenrollment transition foundation.
-- Safe schema-only migration: no remote calls, no destructive changes, no data rewrite.

ALTER TABLE "RematriculaFamiliar"
  ADD COLUMN "sourceFamilyEnrollmentId" TEXT,
  ADD COLUMN "sourceFinancialAgreementId" TEXT,
  ADD COLUMN "step" TEXT,
  ADD COLUMN "effectiveAt" TIMESTAMP(3),
  ADD COLUMN "previewSnapshot" JSONB,
  ADD COLUMN "previewHash" TEXT,
  ADD COLUMN "sourceVersion" TEXT,
  ADD COLUMN "sourceBillingStatus" TEXT,
  ADD COLUMN "targetBillingStatus" TEXT,
  ADD COLUMN "contractStatus" TEXT,
  ADD COLUMN "correlationId" TEXT,
  ADD COLUMN "failureCode" TEXT,
  ADD COLUMN "failureMessage" TEXT,
  ADD COLUMN "committedAt" TIMESTAMP(3);

ALTER TABLE "RematriculaFamiliarItem"
  ADD COLUMN "decision" TEXT NOT NULL DEFAULT 'REMATRICULAR_AGORA',
  ADD COLUMN "targetFinancialAgreementId" TEXT,
  ADD COLUMN "targetAllocationId" TEXT,
  ADD COLUMN "academicStatus" TEXT,
  ADD COLUMN "contractStatus" TEXT,
  ADD COLUMN "amount" DECIMAL(12,2),
  ADD COLUMN "validFrom" TIMESTAMP(3),
  ADD COLUMN "validUntil" TIMESTAMP(3),
  ADD COLUMN "decisionReason" TEXT;

ALTER TABLE "StandaloneSubscription"
  ADD COLUMN "validFrom" TIMESTAMP(3),
  ADD COLUMN "validUntil" TIMESTAMP(3),
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "closureScheduledAt" TIMESTAMP(3),
  ADD COLUMN "closureConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "familyTransitionId" TEXT,
  ADD COLUMN "remoteStatus" TEXT,
  ADD COLUMN "remoteStatusUpdatedAt" TIMESTAMP(3);

CREATE TABLE "FamilyFinancialAllocation" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "alunoId" TEXT NOT NULL,
  "matriculaId" TEXT,
  "sourceMatriculaId" TEXT,
  "rematriculaFamiliarId" TEXT,
  "rematriculaFamiliarItemId" TEXT,
  "standaloneSubscriptionId" TEXT,
  "familyGroupId" TEXT,
  "chargeKind" TEXT NOT NULL DEFAULT 'MENSALIDADE',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "amount" DECIMAL(12,2) NOT NULL,
  "baseAmount" DECIMAL(12,2),
  "discountAmount" DECIMAL(12,2),
  "competenceStart" TIMESTAMP(3) NOT NULL,
  "competenceEnd" TIMESTAMP(3),
  "sourceAgreementId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FamilyFinancialAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_rematricula_familiar_conta_correlation"
  ON "RematriculaFamiliar"("contaId", "correlationId");
CREATE INDEX "idx_rematricula_familiar_conta_step_updated"
  ON "RematriculaFamiliar"("contaId", "step", "updatedAt");
CREATE INDEX "idx_rematricula_familiar_conta_preview_hash"
  ON "RematriculaFamiliar"("contaId", "previewHash");
CREATE INDEX "idx_rematricula_familiar_conta_source_family"
  ON "RematriculaFamiliar"("contaId", "sourceFamilyEnrollmentId");
CREATE INDEX "idx_rematricula_familiar_conta_source_agreement"
  ON "RematriculaFamiliar"("contaId", "sourceFinancialAgreementId");

CREATE INDEX "idx_rematricula_familiar_item_target_agreement"
  ON "RematriculaFamiliarItem"("targetFinancialAgreementId");
CREATE INDEX "idx_rematricula_familiar_item_target_allocation"
  ON "RematriculaFamiliarItem"("targetAllocationId");
CREATE INDEX "idx_rematricula_familiar_item_decision"
  ON "RematriculaFamiliarItem"("decision");

CREATE UNIQUE INDEX "uq_family_fin_alloc_identity"
  ON "FamilyFinancialAllocation"("contaId", "matriculaId", "chargeKind", "competenceStart", "standaloneSubscriptionId");
CREATE INDEX "idx_family_fin_alloc_conta_aluno_period"
  ON "FamilyFinancialAllocation"("contaId", "alunoId", "chargeKind", "competenceStart", "competenceEnd");
CREATE INDEX "idx_family_fin_alloc_conta_rematricula"
  ON "FamilyFinancialAllocation"("contaId", "rematriculaFamiliarId");
CREATE INDEX "idx_family_fin_alloc_conta_subscription"
  ON "FamilyFinancialAllocation"("contaId", "standaloneSubscriptionId");
CREATE INDEX "idx_family_fin_alloc_conta_family_group"
  ON "FamilyFinancialAllocation"("contaId", "familyGroupId");

CREATE INDEX "idx_standalone_subscription_conta_transition"
  ON "StandaloneSubscription"("contaId", "familyTransitionId");
CREATE INDEX "idx_standalone_subscription_conta_validity"
  ON "StandaloneSubscription"("contaId", "validFrom", "validUntil");
