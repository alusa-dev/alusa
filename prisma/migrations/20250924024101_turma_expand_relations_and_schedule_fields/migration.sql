/*
  Warnings:

  - You are about to drop the column `horarioFim` on the `Turma` table. All the data in the column will be lost.
  - You are about to drop the column `horarioInicio` on the `Turma` table. All the data in the column will be lost.
  - You are about to drop the column `modalidade` on the `Turma` table. All the data in the column will be lost.
  - You are about to drop the column `sala` on the `Turma` table. All the data in the column will be lost.
  - Added the required column `capacidade` to the `Turma` table without a default value. This is not possible if the table is not empty.
  - Added the required column `horaFim` to the `Turma` table without a default value. This is not possible if the table is not empty.
  - Added the required column `horaInicio` to the `Turma` table without a default value. This is not possible if the table is not empty.
  - Added the required column `modalidadeId` to the `Turma` table without a default value. This is not possible if the table is not empty.
  - Added the required column `salaId` to the `Turma` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Turma" DROP COLUMN "horarioFim",
DROP COLUMN "horarioInicio",
DROP COLUMN "modalidade",
DROP COLUMN "sala",
ADD COLUMN     "capacidade" INTEGER NOT NULL,
ADD COLUMN     "horaFim" TEXT NOT NULL,
ADD COLUMN     "horaInicio" TEXT NOT NULL,
ADD COLUMN     "idadeMax" INTEGER,
ADD COLUMN     "idadeMin" INTEGER,
ADD COLUMN     "modalidadeId" TEXT NOT NULL,
ADD COLUMN     "observacao" TEXT,
ADD COLUMN     "salaId" TEXT NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'ATIVO';

-- CreateTable
CREATE TABLE IF NOT EXISTS "Modalidade" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ATIVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Modalidade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Sala" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "capacidade" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ATIVA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sala_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_modalidade_conta" ON "Modalidade"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Modalidade_contaId_nome_key" ON "Modalidade"("contaId", "nome");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_sala_conta" ON "Sala"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Sala_contaId_nome_key" ON "Sala"("contaId", "nome");

-- CreateIndex
CREATE INDEX "Turma_modalidadeId_idx" ON "Turma"("modalidadeId");

-- CreateIndex
CREATE INDEX "Turma_salaId_idx" ON "Turma"("salaId");

-- AddForeignKey
DO $$
BEGIN
  ALTER TABLE "Turma" ADD CONSTRAINT "Turma_modalidadeId_fkey" FOREIGN KEY ("modalidadeId") REFERENCES "Modalidade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Turma" ADD CONSTRAINT "Turma_salaId_fkey" FOREIGN KEY ("salaId") REFERENCES "Sala"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Modalidade" ADD CONSTRAINT "Modalidade_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "Sala" ADD CONSTRAINT "Sala_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
