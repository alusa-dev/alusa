CREATE TYPE "StatusTransferenciaAcademica" AS ENUM ('PENDENTE', 'FORMALIZADA');

ALTER TABLE "TransferenciaAcademicaVinculo"
  ADD COLUMN "status" "StatusTransferenciaAcademica" NOT NULL DEFAULT 'FORMALIZADA',
  ADD COLUMN "solicitadaPor" TEXT,
  ALTER COLUMN "formalizadaEm" DROP NOT NULL,
  ALTER COLUMN "formalizadaPor" DROP NOT NULL;

ALTER TYPE "TipoOperacaoMatricula" ADD VALUE 'REGULARIZACAO_PAUSA';

CREATE INDEX "idx_transferencia_academica_conta_status_created"
  ON "TransferenciaAcademicaVinculo"("contaId", "status", "createdAt");
