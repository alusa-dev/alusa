-- Contratos: hardening incremental de assinatura eletrônica.
-- Mantém compatibilidade com links legados em "tokenPublico", mas novas emissões passam a usar hash.

CREATE TYPE "ContractEvidenceType" AS ENUM (
  'CONTRACT_CREATED',
  'PUBLIC_LINK_CREATED',
  'PUBLIC_LINK_OPENED',
  'PDF_VIEWED',
  'SIGNATURE_STARTED',
  'SIGNATURE_ACCEPTED',
  'SIGNATURE_COMPLETED',
  'SIGNATURE_REJECTED',
  'LINK_EXPIRED',
  'CONTRACT_CANCELLED',
  'SIGNED_PDF_GENERATED'
);

CREATE TYPE "ContratoDocumentoTipo" AS ENUM (
  'MODELO_ORIGINAL',
  'GERADO_MATRICULA',
  'ASSINADO',
  'CERTIFICADO_EVIDENCIAS'
);

ALTER TABLE "Contrato"
  ADD COLUMN IF NOT EXISTS "contaId" TEXT,
  ADD COLUMN IF NOT EXISTS "tokenPublicoHash" TEXT,
  ADD COLUMN IF NOT EXISTS "arquivoPdfAssinadoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "hashPdfAssinado" TEXT;

UPDATE "Contrato" c
SET "contaId" = m."contaId"
FROM "Matricula" m
WHERE c."matriculaId" = m."id"
  AND c."contaId" IS NULL;

ALTER TABLE "Contrato" ALTER COLUMN "contaId" SET NOT NULL;

CREATE TABLE "ContractEvidence" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "contratoId" TEXT NOT NULL,
  "type" "ContractEvidenceType" NOT NULL,
  "actorType" TEXT,
  "actorId" TEXT,
  "ip" TEXT,
  "userAgent" TEXT,
  "payload" JSONB NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContractEvidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContratoDocumento" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "contratoId" TEXT NOT NULL,
  "tipo" "ContratoDocumentoTipo" NOT NULL,
  "arquivoUrl" TEXT NOT NULL,
  "hashSha256" TEXT NOT NULL,
  "tamanhoBytes" INTEGER,
  "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ContratoDocumento_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_contrato_conta_status" ON "Contrato"("contaId", "status");
CREATE INDEX IF NOT EXISTS "idx_contrato_conta_matricula" ON "Contrato"("contaId", "matriculaId");
CREATE INDEX IF NOT EXISTS "idx_contrato_conta_created" ON "Contrato"("contaId", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_contrato_conta_token_hash" ON "Contrato"("contaId", "tokenPublicoHash");
CREATE INDEX IF NOT EXISTS "idx_contrato_token_hash" ON "Contrato"("tokenPublicoHash");
CREATE INDEX IF NOT EXISTS "idx_contract_evidence_conta_contract_created" ON "ContractEvidence"("contaId", "contratoId", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_contract_evidence_conta_type_created" ON "ContractEvidence"("contaId", "type", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_contrato_documento_conta_contrato" ON "ContratoDocumento"("contaId", "contratoId");
CREATE INDEX IF NOT EXISTS "idx_contrato_documento_conta_tipo" ON "ContratoDocumento"("contaId", "tipo");

ALTER TABLE "Contrato"
  ADD CONSTRAINT "Contrato_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContractEvidence"
  ADD CONSTRAINT "ContractEvidence_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContractEvidence"
  ADD CONSTRAINT "ContractEvidence_contratoId_fkey"
  FOREIGN KEY ("contratoId") REFERENCES "Contrato"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ContratoDocumento"
  ADD CONSTRAINT "ContratoDocumento_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ContratoDocumento"
  ADD CONSTRAINT "ContratoDocumento_contratoId_fkey"
  FOREIGN KEY ("contratoId") REFERENCES "Contrato"("id") ON DELETE CASCADE ON UPDATE CASCADE;
