-- Canonical future reenrollment flow.
-- Additive migration: the new flow prepares future enrollment, reservation,
-- contract and finance locally without mutating the current enrollment.

CREATE TYPE "RematriculaCampanhaStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'CLOSED', 'ARCHIVED');
CREATE TYPE "RematriculaProcessoOrigem" AS ENUM ('CAMPAIGN', 'STANDALONE');
CREATE TYPE "RematriculaHolderType" AS ENUM ('STUDENT', 'RESPONSIBLE');
CREATE TYPE "RematriculaProcessoStatus" AS ENUM ('DRAFT', 'PREVIEWED', 'PARTIALLY_CONFIRMED', 'CONFIRMED', 'WAITING_FOR_START', 'REQUIRES_ATTENTION', 'EFFECTIVE', 'CANCELLED', 'COMPLETED');
CREATE TYPE "RematriculaItemDecision" AS ENUM ('PENDING', 'RENEW', 'DECIDE_LATER', 'DO_NOT_CONTINUE', 'CANCELLED');
CREATE TYPE "RematriculaItemStatus" AS ENUM ('PENDING', 'RENEWED', 'DECIDE_LATER', 'DO_NOT_CONTINUE', 'CANCELLED');
CREATE TYPE "RematriculaReservaStatus" AS ENUM ('NOT_RESERVED', 'RESERVED', 'WAITLISTED', 'EXPIRED', 'CANCELLED', 'CONVERTED');
CREATE TYPE "RematriculaMatriculaFuturaStatus" AS ENUM ('PREPARED', 'SCHEDULED', 'ACTIVE', 'CANCELLED', 'CLOSED');
CREATE TYPE "RematriculaContratoFuturoStatus" AS ENUM ('DRAFT', 'WAITING_SIGNATURE', 'SIGNED_SCHEDULED', 'ACTIVE', 'EXPIRED', 'CANCELLED');
CREATE TYPE "RematriculaFinanceiroFuturoStatus" AS ENUM ('NOT_PREPARED', 'SCHEDULED', 'READY_TO_PROVISION', 'PROVISIONING', 'ACTIVE', 'FAILED', 'CANCELLED');
CREATE TYPE "RematriculaTaxaMomento" AS ENUM ('CHARGE_ON_CONFIRMATION', 'CHARGE_ON_START', 'EXEMPT');
CREATE TYPE "RematriculaTaxaUnidade" AS ENUM ('NO_FEE', 'PER_STUDENT', 'PER_FAMILY');
CREATE TYPE "RematriculaTaxaFinalidade" AS ENUM ('ADMINISTRATIVE_FEE', 'SEAT_RESERVATION', 'ADVANCE_FIRST_TUITION');
CREATE TYPE "RematriculaOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

CREATE TABLE "RematriculaCampanha" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "targetPeriodId" TEXT NOT NULL,
  "nome" TEXT NOT NULL,
  "descricao" TEXT,
  "campaignStartsAt" TIMESTAMP(3) NOT NULL,
  "campaignEndsAt" TIMESTAMP(3),
  "rules" JSONB,
  "audienceDefinition" JSONB,
  "status" "RematriculaCampanhaStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RematriculaCampanha_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RematriculaParticipante" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "campanhaId" TEXT NOT NULL,
  "matriculaOrigemId" TEXT NOT NULL,
  "alunoId" TEXT NOT NULL,
  "responsavelId" TEXT,
  "currentClassId" TEXT,
  "currentContractId" TEXT,
  "currentContractEndsAt" TIMESTAMP(3),
  "eligibilitySnapshot" JSONB,
  "eligibilityReason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'ELIGIBLE',
  "includedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "includedById" TEXT,
  "excludedAt" TIMESTAMP(3),
  "exclusionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RematriculaParticipante_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RematriculaProcesso" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "campanhaId" TEXT,
  "origin" "RematriculaProcessoOrigem" NOT NULL DEFAULT 'STANDALONE',
  "targetPeriodId" TEXT NOT NULL,
  "holderType" "RematriculaHolderType" NOT NULL,
  "holderId" TEXT NOT NULL,
  "status" "RematriculaProcessoStatus" NOT NULL DEFAULT 'DRAFT',
  "sourceVersion" TEXT,
  "previewHash" TEXT,
  "previewSnapshot" JSONB,
  "currentContractEndsAt" TIMESTAMP(3),
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "firstDueDate" TIMESTAMP(3),
  "editableUntil" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "idempotencyKey" TEXT,
  "externalReference" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "renewCount" INTEGER NOT NULL DEFAULT 0,
  "pendingCount" INTEGER NOT NULL DEFAULT 0,
  "nonRenewalCount" INTEGER NOT NULL DEFAULT 0,
  "monthlyTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "enrollmentFeeTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RematriculaProcesso_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RematriculaItem" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "processoId" TEXT NOT NULL,
  "matriculaOrigemId" TEXT NOT NULL,
  "matriculaFuturaId" TEXT,
  "targetPeriodId" TEXT NOT NULL,
  "decision" "RematriculaItemDecision" NOT NULL DEFAULT 'PENDING',
  "status" "RematriculaItemStatus" NOT NULL DEFAULT 'PENDING',
  "futureEnrollmentStatus" "RematriculaMatriculaFuturaStatus",
  "targetType" TEXT,
  "targetClassId" TEXT,
  "targetComboId" TEXT,
  "targetPlanId" TEXT,
  "effectiveAt" TIMESTAMP(3),
  "sourceSnapshot" JSONB,
  "targetSnapshot" JSONB,
  "decisionReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RematriculaItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReservaVagaFutura" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "processoId" TEXT NOT NULL,
  "itemId" TEXT,
  "alunoId" TEXT NOT NULL,
  "matriculaOrigemId" TEXT NOT NULL,
  "matriculaFuturaId" TEXT,
  "targetClassId" TEXT,
  "targetPeriodId" TEXT NOT NULL,
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "origin" "RematriculaProcessoOrigem" NOT NULL DEFAULT 'STANDALONE',
  "status" "RematriculaReservaStatus" NOT NULL DEFAULT 'RESERVED',
  "expiresAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "convertedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReservaVagaFutura_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContratoFuturo" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "processoId" TEXT NOT NULL,
  "itemId" TEXT,
  "matriculaFuturaId" TEXT,
  "contractModelId" TEXT,
  "status" "RematriculaContratoFuturoStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "validFrom" TIMESTAMP(3),
  "validUntil" TIMESTAMP(3),
  "signedAt" TIMESTAMP(3),
  "snapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ContratoFuturo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AcordoFinanceiroFuturo" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "processoId" TEXT NOT NULL,
  "matriculaFuturaId" TEXT,
  "responsavelId" TEXT,
  "status" "RematriculaFinanceiroFuturoStatus" NOT NULL DEFAULT 'SCHEDULED',
  "monthlyTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "enrollmentFeeTotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "firstDueDate" TIMESTAMP(3),
  "effectiveAt" TIMESTAMP(3) NOT NULL,
  "provisionAt" TIMESTAMP(3),
  "externalReference" TEXT NOT NULL,
  "feeChargeMoment" "RematriculaTaxaMomento" NOT NULL DEFAULT 'CHARGE_ON_START',
  "feeUnit" "RematriculaTaxaUnidade" NOT NULL DEFAULT 'NO_FEE',
  "feePurpose" "RematriculaTaxaFinalidade" NOT NULL DEFAULT 'ADMINISTRATIVE_FEE',
  "asaasSubscriptionId" TEXT,
  "asaasPaymentId" TEXT,
  "failureCode" TEXT,
  "failureMessage" TEXT,
  "snapshot" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AcordoFinanceiroFuturo_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RematriculaAuditLog" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "processoId" TEXT,
  "campanhaId" TEXT,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "reason" TEXT,
  "beforeState" JSONB,
  "afterState" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RematriculaAuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RematriculaOutbox" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "processoId" TEXT,
  "eventType" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "RematriculaOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "dedupeKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RematriculaOutbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_rematricula_campanha_conta_status_created" ON "RematriculaCampanha"("contaId", "status", "createdAt");
CREATE INDEX "idx_rematricula_campanha_conta_period_status" ON "RematriculaCampanha"("contaId", "targetPeriodId", "status");
CREATE UNIQUE INDEX "uq_rematricula_participante_campanha_origem" ON "RematriculaParticipante"("campanhaId", "matriculaOrigemId");
CREATE INDEX "idx_rematricula_participante_conta_campanha_status" ON "RematriculaParticipante"("contaId", "campanhaId", "status");
CREATE INDEX "idx_rematricula_participante_conta_origem" ON "RematriculaParticipante"("contaId", "matriculaOrigemId");
CREATE UNIQUE INDEX "uq_rematricula_processo_conta_idempotency" ON "RematriculaProcesso"("contaId", "idempotencyKey");
CREATE UNIQUE INDEX "uq_rematricula_processo_conta_external_ref" ON "RematriculaProcesso"("contaId", "externalReference");
CREATE INDEX "idx_rematricula_processo_conta_status_created" ON "RematriculaProcesso"("contaId", "status", "createdAt");
CREATE INDEX "idx_rematricula_processo_conta_period_status" ON "RematriculaProcesso"("contaId", "targetPeriodId", "status");
CREATE INDEX "idx_rematricula_processo_conta_campanha" ON "RematriculaProcesso"("contaId", "campanhaId");
CREATE INDEX "idx_rematricula_processo_conta_holder" ON "RematriculaProcesso"("contaId", "holderType", "holderId");
CREATE INDEX "idx_rematricula_processo_conta_effective_status" ON "RematriculaProcesso"("contaId", "effectiveAt", "status");
CREATE UNIQUE INDEX "uq_rematricula_item_processo_origem" ON "RematriculaItem"("processoId", "matriculaOrigemId");
CREATE UNIQUE INDEX "uq_rematricula_item_conta_origem_period" ON "RematriculaItem"("contaId", "matriculaOrigemId", "targetPeriodId");
CREATE INDEX "idx_rematricula_item_conta_decision" ON "RematriculaItem"("contaId", "decision");
CREATE INDEX "idx_rematricula_item_conta_origem" ON "RematriculaItem"("contaId", "matriculaOrigemId");
CREATE INDEX "idx_rematricula_item_futura" ON "RematriculaItem"("matriculaFuturaId");
CREATE INDEX "idx_reserva_futura_conta_turma_period_status" ON "ReservaVagaFutura"("contaId", "targetClassId", "targetPeriodId", "status");
CREATE INDEX "idx_reserva_futura_conta_processo" ON "ReservaVagaFutura"("contaId", "processoId");
CREATE INDEX "idx_reserva_futura_conta_origem_period" ON "ReservaVagaFutura"("contaId", "matriculaOrigemId", "targetPeriodId");
CREATE INDEX "idx_contrato_futuro_conta_status_created" ON "ContratoFuturo"("contaId", "status", "createdAt");
CREATE INDEX "idx_contrato_futuro_conta_processo" ON "ContratoFuturo"("contaId", "processoId");
CREATE UNIQUE INDEX "uq_acordo_financeiro_futuro_conta_external" ON "AcordoFinanceiroFuturo"("contaId", "externalReference");
CREATE INDEX "idx_acordo_financeiro_futuro_conta_status_provision" ON "AcordoFinanceiroFuturo"("contaId", "status", "provisionAt");
CREATE INDEX "idx_acordo_financeiro_futuro_conta_processo" ON "AcordoFinanceiroFuturo"("contaId", "processoId");
CREATE INDEX "idx_rematricula_audit_conta_processo_created" ON "RematriculaAuditLog"("contaId", "processoId", "createdAt");
CREATE INDEX "idx_rematricula_audit_conta_action_created" ON "RematriculaAuditLog"("contaId", "action", "createdAt");
CREATE UNIQUE INDEX "uq_rematricula_outbox_conta_dedupe" ON "RematriculaOutbox"("contaId", "dedupeKey");
CREATE INDEX "idx_rematricula_outbox_conta_status_available" ON "RematriculaOutbox"("contaId", "status", "availableAt");
CREATE INDEX "idx_rematricula_outbox_conta_processo" ON "RematriculaOutbox"("contaId", "processoId");

ALTER TABLE "RematriculaCampanha" ADD CONSTRAINT "RematriculaCampanha_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RematriculaParticipante" ADD CONSTRAINT "RematriculaParticipante_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RematriculaParticipante" ADD CONSTRAINT "RematriculaParticipante_campanhaId_fkey" FOREIGN KEY ("campanhaId") REFERENCES "RematriculaCampanha"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RematriculaParticipante" ADD CONSTRAINT "RematriculaParticipante_matriculaOrigemId_fkey" FOREIGN KEY ("matriculaOrigemId") REFERENCES "Matricula"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RematriculaProcesso" ADD CONSTRAINT "RematriculaProcesso_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RematriculaProcesso" ADD CONSTRAINT "RematriculaProcesso_campanhaId_fkey" FOREIGN KEY ("campanhaId") REFERENCES "RematriculaCampanha"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RematriculaItem" ADD CONSTRAINT "RematriculaItem_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RematriculaItem" ADD CONSTRAINT "RematriculaItem_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "RematriculaProcesso"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RematriculaItem" ADD CONSTRAINT "RematriculaItem_matriculaOrigemId_fkey" FOREIGN KEY ("matriculaOrigemId") REFERENCES "Matricula"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RematriculaItem" ADD CONSTRAINT "RematriculaItem_matriculaFuturaId_fkey" FOREIGN KEY ("matriculaFuturaId") REFERENCES "Matricula"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReservaVagaFutura" ADD CONSTRAINT "ReservaVagaFutura_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReservaVagaFutura" ADD CONSTRAINT "ReservaVagaFutura_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "RematriculaProcesso"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReservaVagaFutura" ADD CONSTRAINT "ReservaVagaFutura_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "RematriculaItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ContratoFuturo" ADD CONSTRAINT "ContratoFuturo_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContratoFuturo" ADD CONSTRAINT "ContratoFuturo_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "RematriculaProcesso"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContratoFuturo" ADD CONSTRAINT "ContratoFuturo_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "RematriculaItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AcordoFinanceiroFuturo" ADD CONSTRAINT "AcordoFinanceiroFuturo_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AcordoFinanceiroFuturo" ADD CONSTRAINT "AcordoFinanceiroFuturo_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "RematriculaProcesso"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RematriculaAuditLog" ADD CONSTRAINT "RematriculaAuditLog_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RematriculaAuditLog" ADD CONSTRAINT "RematriculaAuditLog_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "RematriculaProcesso"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RematriculaAuditLog" ADD CONSTRAINT "RematriculaAuditLog_campanhaId_fkey" FOREIGN KEY ("campanhaId") REFERENCES "RematriculaCampanha"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RematriculaOutbox" ADD CONSTRAINT "RematriculaOutbox_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RematriculaOutbox" ADD CONSTRAINT "RematriculaOutbox_processoId_fkey" FOREIGN KEY ("processoId") REFERENCES "RematriculaProcesso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
DECLARE
  rel_name text;
  tenant_tables text[] := ARRAY[
    'RematriculaCampanha',
    'RematriculaParticipante',
    'RematriculaProcesso',
    'RematriculaItem',
    'ReservaVagaFutura',
    'ContratoFuturo',
    'AcordoFinanceiroFuturo',
    'RematriculaAuditLog',
    'RematriculaOutbox'
  ];
BEGIN
  IF to_regnamespace('app_security') IS NOT NULL THEN
    FOREACH rel_name IN ARRAY tenant_tables LOOP
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rel_name);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON public.%I', rel_name);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON public.%I USING (%I = app_security.current_conta_id()) WITH CHECK (%I = app_security.current_conta_id())',
        rel_name,
        'contaId',
        'contaId'
      );
    END LOOP;
  END IF;
END $$;
