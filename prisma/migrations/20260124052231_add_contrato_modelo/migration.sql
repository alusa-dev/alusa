/*
  Warnings:

  - You are about to drop the column `pdfGeradoEm` on the `Contrato` table. All the data in the column will be lost.
  - You are about to drop the column `pdfUrl` on the `Contrato` table. All the data in the column will be lost.
  - Added the required column `arquivoPdfUrl` to the `Contrato` table without a default value. This is not possible if the table is not empty.
  - Added the required column `hashPdf` to the `Contrato` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Contrato" DROP CONSTRAINT IF EXISTS "Contrato_templateId_fkey";

-- Create ContratoModelo table first
CREATE TABLE "ContratoModelo" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "descricao" TEXT,
    "arquivoOriginalUrl" TEXT,
    "arquivoPdfUrl" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'application/pdf',
    "hashSha256" TEXT NOT NULL,
    "tamanhoBytes" INTEGER,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "status" "Status" NOT NULL DEFAULT 'ATIVO',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContratoModelo_pkey" PRIMARY KEY ("id")
);

-- AlterTable - Add new columns with defaults first, then update, then make required
ALTER TABLE "Contrato" 
ADD COLUMN IF NOT EXISTS "arquivoPdfUrl" TEXT,
ADD COLUMN IF NOT EXISTS "hashPdf" TEXT,
ADD COLUMN IF NOT EXISTS "modeloId" TEXT;

-- Migrate data from pdfUrl to arquivoPdfUrl if pdfUrl exists
UPDATE "Contrato" SET 
  "arquivoPdfUrl" = COALESCE("pdfUrl", '/uploads/contratos/migrated-contract.pdf'),
  "hashPdf" = COALESCE(md5("conteudoFinal"::text), 'migrated-hash-placeholder')
WHERE "arquivoPdfUrl" IS NULL;

-- Make columns required after migration
ALTER TABLE "Contrato" ALTER COLUMN "arquivoPdfUrl" SET NOT NULL;
ALTER TABLE "Contrato" ALTER COLUMN "hashPdf" SET NOT NULL;

-- Drop old columns if they exist
ALTER TABLE "Contrato" DROP COLUMN IF EXISTS "pdfGeradoEm";
ALTER TABLE "Contrato" DROP COLUMN IF EXISTS "pdfUrl";

-- Make conteudoFinal optional
ALTER TABLE "Contrato" ALTER COLUMN "conteudoFinal" DROP NOT NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_contrato_modelo_conta" ON "ContratoModelo"("contaId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_contrato_modelo_status" ON "ContratoModelo"("status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ContratoModelo_contaId_nome_versao_key" ON "ContratoModelo"("contaId", "nome", "versao");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_contrato_modelo" ON "Contrato"("modeloId");

-- AddForeignKey
ALTER TABLE "ContratoModelo" ADD CONSTRAINT "ContratoModelo_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contrato" ADD CONSTRAINT "Contrato_modeloId_fkey" FOREIGN KEY ("modeloId") REFERENCES "ContratoModelo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
