/*
  Warnings:

  - The values [DINHEIRO,CARTAO] on the enum `FormaPagamento` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "FormaPagamento_new" AS ENUM ('BOLETO', 'PIX', 'CARTAO_CREDITO', 'INDEFINIDO');
ALTER TABLE "Cobranca" ALTER COLUMN "formaPagamento" DROP DEFAULT;
ALTER TABLE "Matricula" ALTER COLUMN "formaPagamentoTaxa" DROP DEFAULT;
ALTER TABLE "Matricula" ALTER COLUMN "formaPagamentoTaxa" TYPE "FormaPagamento_new" USING ("formaPagamentoTaxa"::text::"FormaPagamento_new");
ALTER TABLE "Cobranca" ALTER COLUMN "formaPagamento" TYPE "FormaPagamento_new" USING ("formaPagamento"::text::"FormaPagamento_new");
ALTER TYPE "FormaPagamento" RENAME TO "FormaPagamento_old";
ALTER TYPE "FormaPagamento_new" RENAME TO "FormaPagamento";
DROP TYPE "FormaPagamento_old";
ALTER TABLE "Cobranca" ALTER COLUMN "formaPagamento" SET DEFAULT 'BOLETO';
ALTER TABLE "Matricula" ALTER COLUMN "formaPagamentoTaxa" SET DEFAULT 'BOLETO';
COMMIT;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


-- ALTER TYPE "TipoCobranca" ADD VALUE IF NOT EXISTS 'PARCELADA';
ALTER TYPE "TipoCobranca" ADD VALUE IF NOT EXISTS 'RECORRENTE';
