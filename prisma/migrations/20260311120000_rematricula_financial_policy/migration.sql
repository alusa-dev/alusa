-- CreateEnum
CREATE TYPE "RematriculaDebtPolicy" AS ENUM (
  'PERMITIR_NORMALMENTE',
  'PERMITIR_COM_AVISO',
  'PERMITIR_COM_OVERRIDE',
  'BLOQUEAR'
);

-- CreateEnum
CREATE TYPE "RematriculaDebtScope" AS ENUM (
  'QUALQUER_COBRANCA_EM_ABERTO',
  'APENAS_VENCIDAS',
  'MULTIPLAS_EM_ABERTO'
);

-- CreateEnum
CREATE TYPE "RematriculaActionStatus" AS ENUM (
  'LIBERADA',
  'LIBERADA_COM_AVISO',
  'REQUER_OVERRIDE',
  'BLOQUEADA'
);

-- CreateEnum
CREATE TYPE "RematriculaBlockReason" AS ENUM (
  'SEM_BLOQUEIO',
  'COBRANCA_EM_ABERTO',
  'COBRANCA_ATRASADA',
  'MULTIPLAS_COBRANCAS',
  'AGUARDANDO_RECONCILIACAO',
  'POLITICA_DA_ESCOLA',
  'OUTRO'
);

-- CreateTable
CREATE TABLE "ContaFinancialPolicy" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "rematriculaDebtPolicy" "RematriculaDebtPolicy" NOT NULL DEFAULT 'PERMITIR_NORMALMENTE',
  "allowNewFinancialCycleWithOpenDebt" BOOLEAN NOT NULL DEFAULT true,
  "debtScope" "RematriculaDebtScope" NOT NULL DEFAULT 'QUALQUER_COBRANCA_EM_ABERTO',
  "overrideRoles" TEXT[] DEFAULT ARRAY['ADMIN', 'FINANCEIRO']::TEXT[],
  "requireOverrideReason" BOOLEAN NOT NULL DEFAULT true,
  "requireFullAudit" BOOLEAN NOT NULL DEFAULT true,
  "blockOnUnknownFinancialStatus" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContaFinancialPolicy_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "RematriculaOperacao"
  ADD COLUMN "policySnapshot" JSONB,
  ADD COLUMN "financialSnapshot" JSONB,
  ADD COLUMN "actionStatus" "RematriculaActionStatus",
  ADD COLUMN "blockReason" "RematriculaBlockReason" DEFAULT 'SEM_BLOQUEIO',
  ADD COLUMN "overrideUsed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "overrideReason" TEXT,
  ADD COLUMN "overrideApprovedById" TEXT,
  ADD COLUMN "evaluatedAt" TIMESTAMP(3),
  ADD COLUMN "blockedAt" TIMESTAMP(3);

-- Normaliza duplicidades antes da unique
WITH ranked AS (
  SELECT
    "id",
    "idempotencyKey",
    ROW_NUMBER() OVER (PARTITION BY "idempotencyKey" ORDER BY "createdAt", "id") AS rn
  FROM "RematriculaOperacao"
  WHERE "idempotencyKey" IS NOT NULL
)
UPDATE "RematriculaOperacao" ro
SET "idempotencyKey" = CONCAT(ro."idempotencyKey", ':legacy:', ro."id")
FROM ranked
WHERE ro."id" = ranked."id"
  AND ranked.rn > 1;

-- CreateIndex
CREATE UNIQUE INDEX "ContaFinancialPolicy_contaId_key" ON "ContaFinancialPolicy"("contaId");

-- CreateIndex
CREATE INDEX "ContaFinancialPolicy_contaId_idx" ON "ContaFinancialPolicy"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "RematriculaOperacao_idempotencyKey_key" ON "RematriculaOperacao"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "ContaFinancialPolicy"
  ADD CONSTRAINT "ContaFinancialPolicy_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RematriculaOperacao"
  ADD CONSTRAINT "RematriculaOperacao_overrideApprovedById_fkey"
  FOREIGN KEY ("overrideApprovedById") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;