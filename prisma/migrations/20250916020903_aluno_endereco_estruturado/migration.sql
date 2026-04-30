/*
  Warnings:

  - You are about to drop the column `endereco` on the `Aluno` table. All the data in the column will be lost.
  - You are about to drop the column `endereco` on the `Responsavel` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Aluno" DROP COLUMN "endereco",
ADD COLUMN     "enderecoBairro" TEXT,
ADD COLUMN     "enderecoCep" TEXT,
ADD COLUMN     "enderecoCidade" TEXT,
ADD COLUMN     "enderecoComplemento" TEXT,
ADD COLUMN     "enderecoLogradouro" TEXT,
ADD COLUMN     "enderecoNumero" TEXT,
ADD COLUMN     "enderecoUf" TEXT;

-- AlterTable
ALTER TABLE "Responsavel" DROP COLUMN "endereco",
ADD COLUMN     "enderecoBairro" TEXT,
ADD COLUMN     "enderecoCep" TEXT,
ADD COLUMN     "enderecoCidade" TEXT,
ADD COLUMN     "enderecoComplemento" TEXT,
ADD COLUMN     "enderecoLogradouro" TEXT,
ADD COLUMN     "enderecoNumero" TEXT,
ADD COLUMN     "enderecoUf" TEXT;
