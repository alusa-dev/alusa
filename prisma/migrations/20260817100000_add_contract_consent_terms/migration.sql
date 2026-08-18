-- Consentimentos configuráveis por modelo de contrato.
-- Compatível com modelos e contratos existentes: novos campos são opcionais.

CREATE TYPE "ContratoConsentimentoFinalidade" AS ENUM (
  'IMAGE_USE',
  'MARKETING',
  'COMMUNICATIONS',
  'OTHER'
);

CREATE TYPE "ContratoConsentimentoPapel" AS ENUM (
  'RESPONSAVEL_OU_ALUNO'
);

ALTER TYPE "ContractEvidenceType" ADD VALUE IF NOT EXISTS 'CONSENT_DECISION_RECORDED';

CREATE TABLE "ContratoModeloConsentimento" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "modeloId" TEXT NOT NULL,
  "codigo" TEXT NOT NULL,
  "finalidade" "ContratoConsentimentoFinalidade" NOT NULL,
  "titulo" TEXT NOT NULL,
  "texto" TEXT NOT NULL,
  "papel" "ContratoConsentimentoPapel" NOT NULL DEFAULT 'RESPONSAVEL_OU_ALUNO',
  "obrigatorio" BOOLEAN NOT NULL DEFAULT true,
  "recusaImpedeAssinatura" BOOLEAN NOT NULL DEFAULT false,
  "ordem" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ContratoModeloConsentimento_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ContratoModeloConsentimento"
  ADD CONSTRAINT "ContratoModeloConsentimento_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContratoModeloConsentimento"
  ADD CONSTRAINT "ContratoModeloConsentimento_modeloId_fkey"
  FOREIGN KEY ("modeloId") REFERENCES "ContratoModelo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "uq_contrato_modelo_consentimento_codigo"
  ON "ContratoModeloConsentimento"("contaId", "modeloId", "codigo");

CREATE INDEX "idx_contrato_modelo_consentimento_ordem"
  ON "ContratoModeloConsentimento"("contaId", "modeloId", "ordem");

ALTER TABLE "Contrato"
  ADD COLUMN "termosConsentimentoSnapshot" JSONB,
  ADD COLUMN "decisoesConsentimento" JSONB;

ALTER TABLE "EventoContrato"
  ADD COLUMN "termosConsentimentoSnapshot" JSONB,
  ADD COLUMN "decisoesConsentimento" JSONB;
