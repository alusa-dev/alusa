-- Governance layer for the canonical future reenrollment flow.
-- Adds tenant-scoped pending issues, manual exceptions and communication history.

CREATE TYPE "RematriculaPendenciaTipo" AS ENUM (
  'ACTIVATION_BLOCKED',
  'FINANCIAL_PROVISION_FAILED',
  'CONTRACT_SIGNATURE_PENDING',
  'CAPACITY_UNAVAILABLE',
  'INTEGRITY_VIOLATION',
  'WEBHOOK_UNCORRELATED',
  'MANUAL_REVIEW'
);

CREATE TYPE "RematriculaPendenciaStatus" AS ENUM (
  'OPEN',
  'IN_PROGRESS',
  'RESOLVED',
  'DISMISSED'
);

CREATE TYPE "RematriculaPendenciaSeveridade" AS ENUM (
  'INFO',
  'WARNING',
  'BLOCKER',
  'CRITICAL'
);

CREATE TYPE "RematriculaExcecaoStatus" AS ENUM (
  'GRANTED',
  'REVOKED',
  'EXPIRED'
);

CREATE TYPE "RematriculaComunicacaoCanal" AS ENUM (
  'EMAIL',
  'WHATSAPP',
  'SMS',
  'PORTAL'
);

CREATE TYPE "RematriculaComunicacaoStatus" AS ENUM (
  'DRAFT',
  'SCHEDULED',
  'SENT',
  'FAILED',
  'CANCELLED'
);

CREATE TABLE "RematriculaPendencia" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "processoId" TEXT,
  "campanhaId" TEXT,
  "itemId" TEXT,
  "type" "RematriculaPendenciaTipo" NOT NULL,
  "severity" "RematriculaPendenciaSeveridade" NOT NULL DEFAULT 'BLOCKER',
  "status" "RematriculaPendenciaStatus" NOT NULL DEFAULT 'OPEN',
  "code" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "rule" TEXT,
  "impact" TEXT,
  "resolution" TEXT,
  "metadata" JSONB,
  "createdById" TEXT,
  "resolvedById" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RematriculaPendencia_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RematriculaExcecao" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "processoId" TEXT,
  "campanhaId" TEXT,
  "itemId" TEXT,
  "permission" TEXT NOT NULL,
  "rule" TEXT NOT NULL,
  "impact" TEXT NOT NULL,
  "justification" TEXT NOT NULL,
  "status" "RematriculaExcecaoStatus" NOT NULL DEFAULT 'GRANTED',
  "actorId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "revokedById" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RematriculaExcecao_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RematriculaComunicacao" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "processoId" TEXT,
  "campanhaId" TEXT,
  "participanteId" TEXT,
  "channel" "RematriculaComunicacaoCanal" NOT NULL,
  "audience" TEXT NOT NULL,
  "status" "RematriculaComunicacaoStatus" NOT NULL DEFAULT 'DRAFT',
  "subject" TEXT,
  "message" TEXT NOT NULL,
  "payload" JSONB,
  "scheduledAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "failureMessage" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RematriculaComunicacao_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_rematricula_pendencia_conta_status_created"
  ON "RematriculaPendencia"("contaId", "status", "createdAt");

CREATE INDEX "idx_rematricula_pendencia_conta_processo_status"
  ON "RematriculaPendencia"("contaId", "processoId", "status");

CREATE INDEX "idx_rematricula_pendencia_conta_campanha_status"
  ON "RematriculaPendencia"("contaId", "campanhaId", "status");

CREATE INDEX "idx_rematricula_pendencia_conta_type_status"
  ON "RematriculaPendencia"("contaId", "type", "status");

CREATE INDEX "idx_rematricula_excecao_conta_status_created"
  ON "RematriculaExcecao"("contaId", "status", "createdAt");

CREATE INDEX "idx_rematricula_excecao_conta_processo_status"
  ON "RematriculaExcecao"("contaId", "processoId", "status");

CREATE INDEX "idx_rematricula_excecao_conta_permission_status"
  ON "RematriculaExcecao"("contaId", "permission", "status");

CREATE INDEX "idx_rematricula_comunicacao_conta_status_scheduled"
  ON "RematriculaComunicacao"("contaId", "status", "scheduledAt");

CREATE INDEX "idx_rematricula_comunicacao_conta_processo_status"
  ON "RematriculaComunicacao"("contaId", "processoId", "status");

CREATE INDEX "idx_rematricula_comunicacao_conta_campanha_status"
  ON "RematriculaComunicacao"("contaId", "campanhaId", "status");

ALTER TABLE "RematriculaPendencia"
  ADD CONSTRAINT "RematriculaPendencia_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RematriculaPendencia"
  ADD CONSTRAINT "RematriculaPendencia_processoId_fkey"
  FOREIGN KEY ("processoId") REFERENCES "RematriculaProcesso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RematriculaPendencia"
  ADD CONSTRAINT "RematriculaPendencia_campanhaId_fkey"
  FOREIGN KEY ("campanhaId") REFERENCES "RematriculaCampanha"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RematriculaPendencia"
  ADD CONSTRAINT "RematriculaPendencia_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "RematriculaItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RematriculaExcecao"
  ADD CONSTRAINT "RematriculaExcecao_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RematriculaExcecao"
  ADD CONSTRAINT "RematriculaExcecao_processoId_fkey"
  FOREIGN KEY ("processoId") REFERENCES "RematriculaProcesso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RematriculaExcecao"
  ADD CONSTRAINT "RematriculaExcecao_campanhaId_fkey"
  FOREIGN KEY ("campanhaId") REFERENCES "RematriculaCampanha"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RematriculaExcecao"
  ADD CONSTRAINT "RematriculaExcecao_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "RematriculaItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RematriculaComunicacao"
  ADD CONSTRAINT "RematriculaComunicacao_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RematriculaComunicacao"
  ADD CONSTRAINT "RematriculaComunicacao_processoId_fkey"
  FOREIGN KEY ("processoId") REFERENCES "RematriculaProcesso"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RematriculaComunicacao"
  ADD CONSTRAINT "RematriculaComunicacao_campanhaId_fkey"
  FOREIGN KEY ("campanhaId") REFERENCES "RematriculaCampanha"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RematriculaComunicacao"
  ADD CONSTRAINT "RematriculaComunicacao_participanteId_fkey"
  FOREIGN KEY ("participanteId") REFERENCES "RematriculaParticipante"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DO $$
DECLARE
  rel_name text;
BEGIN
  FOREACH rel_name IN ARRAY ARRAY[
    'RematriculaPendencia',
    'RematriculaExcecao',
    'RematriculaComunicacao'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', rel_name);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON public.%I USING (%I = app_security.current_conta_id()) WITH CHECK (%I = app_security.current_conta_id())',
      rel_name,
      'contaId',
      'contaId'
    );
  END LOOP;
END $$;

