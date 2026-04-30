-- CreateEnum
CREATE TYPE "IntegrationSyncStatus" AS ENUM ('PENDENTE_SINCRONISMO', 'SINCRONIZADO', 'DIVERGENTE');

-- CreateEnum
CREATE TYPE "TipoOperacaoMatricula" AS ENUM ('PAUSA', 'REATIVACAO', 'CANCELAMENTO', 'RECONCILIACAO');

-- CreateEnum
CREATE TYPE "OrigemOperacao" AS ENUM ('USER', 'WEBHOOK', 'JOB');

-- CreateEnum
CREATE TYPE "StatusOperacao" AS ENUM ('PENDENTE_SINCRONISMO', 'SINCRONIZADO', 'ERRO', 'DIVERGENTE');

-- AlterTable
ALTER TABLE "Matricula" ADD COLUMN     "cobrarDurantePausa" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "dataInicioPausa" TIMESTAMP(3),
ADD COLUMN     "dataRetornoPrevista" TIMESTAMP(3),
ADD COLUMN     "integrationStatus" "IntegrationSyncStatus" NOT NULL DEFAULT 'SINCRONIZADO',
ADD COLUMN     "manterVaga" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "motivoPausa" TEXT,
ADD COLUMN     "pausaAtiva" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "warningCode" TEXT;

-- CreateTable
CREATE TABLE "MatriculaOperacao" (
    "id" TEXT NOT NULL,
    "matriculaId" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "tipo" "TipoOperacaoMatricula" NOT NULL,
    "origem" "OrigemOperacao" NOT NULL,
    "status" "StatusOperacao" NOT NULL DEFAULT 'PENDENTE_SINCRONISMO',
    "correlationId" TEXT NOT NULL,
    "payloadEnviado" JSONB,
    "payloadRecebido" JSONB,
    "erro" TEXT,
    "actorId" TEXT,
    "observacao" TEXT,
    "metadata" JSONB,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MatriculaOperacao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MatriculaOperacao_correlationId_key" ON "MatriculaOperacao"("correlationId");

-- CreateIndex
CREATE INDEX "idx_operacao_matricula" ON "MatriculaOperacao"("matriculaId");

-- CreateIndex
CREATE INDEX "idx_operacao_conta" ON "MatriculaOperacao"("contaId");

-- CreateIndex
CREATE INDEX "idx_operacao_tipo" ON "MatriculaOperacao"("tipo");

-- CreateIndex
CREATE INDEX "idx_operacao_status" ON "MatriculaOperacao"("status");

-- CreateIndex
CREATE INDEX "idx_operacao_correlation" ON "MatriculaOperacao"("correlationId");

-- AddForeignKey
ALTER TABLE "MatriculaOperacao" ADD CONSTRAINT "MatriculaOperacao_matriculaId_fkey" FOREIGN KEY ("matriculaId") REFERENCES "Matricula"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatriculaOperacao" ADD CONSTRAINT "MatriculaOperacao_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatriculaOperacao" ADD CONSTRAINT "MatriculaOperacao_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
