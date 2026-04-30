-- CreateEnum
CREATE TYPE "RematriculaOperacaoStatus" AS ENUM ('PENDING', 'PENDING_FINANCE', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "PayerType" AS ENUM ('ALUNO', 'RESPONSAVEL');

-- CreateTable
CREATE TABLE "RematriculaOperacao" (
    "id" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "matriculaOrigemId" TEXT NOT NULL,
    "matriculaNovaId" TEXT,
    "status" "RematriculaOperacaoStatus" NOT NULL DEFAULT 'PENDING',
    "oldSubscriptionId" TEXT,
    "newSubscriptionId" TEXT,
    "customerId" TEXT,
    "payerType" "PayerType" NOT NULL,
    "payerId" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RematriculaOperacao_pkey" PRIMARY KEY ("id")
);

-- AddColumn to Matricula
ALTER TABLE "Matricula" ADD COLUMN "rematriculadaDeId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "RematriculaOperacao_correlationId_key" ON "RematriculaOperacao"("correlationId");

-- CreateIndex
CREATE INDEX "RematriculaOperacao_contaId_idx" ON "RematriculaOperacao"("contaId");

-- CreateIndex
CREATE INDEX "RematriculaOperacao_matriculaOrigemId_idx" ON "RematriculaOperacao"("matriculaOrigemId");

-- CreateIndex
CREATE INDEX "RematriculaOperacao_status_idx" ON "RematriculaOperacao"("status");

-- AddForeignKey
ALTER TABLE "RematriculaOperacao" ADD CONSTRAINT "RematriculaOperacao_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RematriculaOperacao" ADD CONSTRAINT "RematriculaOperacao_matriculaOrigemId_fkey" FOREIGN KEY ("matriculaOrigemId") REFERENCES "Matricula"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RematriculaOperacao" ADD CONSTRAINT "RematriculaOperacao_matriculaNovaId_fkey" FOREIGN KEY ("matriculaNovaId") REFERENCES "Matricula"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RematriculaOperacao" ADD CONSTRAINT "RematriculaOperacao_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "Usuario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matricula" ADD CONSTRAINT "Matricula_rematriculadaDeId_fkey" FOREIGN KEY ("rematriculadaDeId") REFERENCES "Matricula"("id") ON DELETE SET NULL ON UPDATE CASCADE;
