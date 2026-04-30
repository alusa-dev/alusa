/*
  Warnings:

  - A unique constraint covering the columns `[cpf]` on the table `Aluno` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[codigoInterno]` on the table `Aluno` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[asaasCustomerId]` on the table `Aluno` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "Genero" AS ENUM ('MASCULINO', 'FEMININO', 'NAO_BINARIO', 'OUTRO', 'PREFERE_NAO_INFORMAR');

-- AlterTable
ALTER TABLE "Aluno" ADD COLUMN     "alergias" TEXT,
ADD COLUMN     "asaasCustomerId" TEXT,
ADD COLUMN     "bolsaDescontoPercent" DECIMAL(5,2),
ADD COLUMN     "codigoInterno" TEXT,
ADD COLUMN     "consentimentoComunicacoes" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "consentimentoImagem" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "contatoEmergenciaNome" TEXT,
ADD COLUMN     "contatoEmergenciaTelefone" TEXT,
ADD COLUMN     "cpf" TEXT,
ADD COLUMN     "dataConsentimentoImagem" TIMESTAMP(3),
ADD COLUMN     "dataInativacao" TIMESTAMP(3),
ADD COLUMN     "genero" "Genero",
ADD COLUMN     "isentoTaxaMatricula" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "modalidadePrincipal" TEXT,
ADD COLUMN     "motivoInativacao" TEXT,
ADD COLUMN     "nivel" TEXT,
ADD COLUMN     "nomeSocial" TEXT,
ADD COLUMN     "origemCadastro" TEXT,
ADD COLUMN     "restricoesMedicas" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "tamanhoCalcado" TEXT,
ADD COLUMN     "tamanhoCamiseta" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Aluno_cpf_key" ON "Aluno"("cpf");

-- CreateIndex
CREATE UNIQUE INDEX "Aluno_codigoInterno_key" ON "Aluno"("codigoInterno");

-- CreateIndex
CREATE UNIQUE INDEX "Aluno_asaasCustomerId_key" ON "Aluno"("asaasCustomerId");
