/*
  Warnings:

  - You are about to drop the column `especialidade` on the `Professor` table. All the data in the column will be lost.
  - You are about to drop the column `telefone` on the `Professor` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[cpf]` on the table `Professor` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[email]` on the table `Professor` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `cpf` to the `Professor` table without a default value. This is not possible if the table is not empty.
  - Added the required column `dataNasc` to the `Professor` table without a default value. This is not possible if the table is not empty.
  - Added the required column `telefoneCel` to the `Professor` table without a default value. This is not possible if the table is not empty.
  - Made the column `email` on table `Professor` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "CargoColaborador" AS ENUM ('PROFESSOR', 'RECEPCAO', 'FINANCEIRO', 'ADMINISTRATIVO', 'OUTRO');

-- CreateEnum
CREATE TYPE "StatusColaborador" AS ENUM ('ATIVO', 'INATIVO');

-- CreateEnum
CREATE TYPE "StatusContratual" AS ENUM ('EFETIVO', 'TEMPORARIO', 'PRESTADOR', 'VOLUNTARIO');

-- DropIndex
DROP INDEX "Professor_contaId_email_key";

-- AlterTable
ALTER TABLE "Professor" DROP COLUMN "especialidade",
DROP COLUMN "telefone",
ADD COLUMN     "bairro" TEXT,
ADD COLUMN     "cargaHoraria" INTEGER,
ADD COLUMN     "cep" TEXT,
ADD COLUMN     "cidade" TEXT,
ADD COLUMN     "complemento" TEXT,
ADD COLUMN     "cpf" TEXT NOT NULL,
ADD COLUMN     "dataAdmissao" TIMESTAMP(3),
ADD COLUMN     "dataNasc" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "especialidades" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "estadoCivil" TEXT,
ADD COLUMN     "formacao" TEXT,
ADD COLUMN     "foto" TEXT,
ADD COLUMN     "logradouro" TEXT,
ADD COLUMN     "miniBio" TEXT,
ADD COLUMN     "nacionalidade" TEXT,
ADD COLUMN     "numero" TEXT,
ADD COLUMN     "rg" TEXT,
ADD COLUMN     "sexo" TEXT,
ADD COLUMN     "statusContratual" "StatusContratual",
ADD COLUMN     "telefoneCel" TEXT NOT NULL,
ADD COLUMN     "telefoneFixo" TEXT,
ADD COLUMN     "uf" CHAR(2),
ALTER COLUMN "email" SET NOT NULL;

-- CreateTable
CREATE TABLE "Colaborador" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "foto" TEXT,
    "nome" TEXT NOT NULL,
    "dataNasc" TIMESTAMP(3),
    "genero" "Genero",
    "cpf" TEXT NOT NULL,
    "rg" TEXT,
    "orgaoEmissor" TEXT,
    "dataEmissao" TIMESTAMP(3),
    "email" TEXT,
    "telefone1" TEXT,
    "telefone2" TEXT,
    "enderecoCep" CHAR(8),
    "enderecoLogradouro" TEXT,
    "enderecoNumero" TEXT,
    "enderecoComplemento" TEXT,
    "enderecoBairro" TEXT,
    "enderecoCidade" TEXT,
    "enderecoUf" CHAR(2),
    "cargo" "CargoColaborador" NOT NULL,
    "status" "StatusColaborador" NOT NULL DEFAULT 'ATIVO',
    "dataAdmissao" TIMESTAMP(3),
    "dataDesligamento" TIMESTAMP(3),
    "observacoes" TEXT,
    "temAcesso" BOOLEAN NOT NULL DEFAULT false,
    "usuarioId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Colaborador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TurmaProfessor" (
    "id" TEXT NOT NULL,
    "turmaId" TEXT NOT NULL,
    "professorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TurmaProfessor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Colaborador_cpf_key" ON "Colaborador"("cpf");

-- CreateIndex
CREATE UNIQUE INDEX "Colaborador_email_key" ON "Colaborador"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Colaborador_usuarioId_key" ON "Colaborador"("usuarioId");

-- CreateIndex
CREATE INDEX "Colaborador_contaId_idx" ON "Colaborador"("contaId");

-- CreateIndex
CREATE INDEX "idx_turmaprofessor_turma" ON "TurmaProfessor"("turmaId");

-- CreateIndex
CREATE INDEX "idx_turmaprofessor_professor" ON "TurmaProfessor"("professorId");

-- CreateIndex
CREATE UNIQUE INDEX "TurmaProfessor_turmaId_professorId_key" ON "TurmaProfessor"("turmaId", "professorId");

-- CreateIndex
CREATE UNIQUE INDEX "Professor_cpf_key" ON "Professor"("cpf");

-- CreateIndex
CREATE UNIQUE INDEX "Professor_email_key" ON "Professor"("email");

-- AddForeignKey
ALTER TABLE "Colaborador" ADD CONSTRAINT "Colaborador_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Colaborador" ADD CONSTRAINT "Colaborador_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TurmaProfessor" ADD CONSTRAINT "TurmaProfessor_turmaId_fkey" FOREIGN KEY ("turmaId") REFERENCES "Turma"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TurmaProfessor" ADD CONSTRAINT "TurmaProfessor_professorId_fkey" FOREIGN KEY ("professorId") REFERENCES "Professor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
