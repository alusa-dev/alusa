/*
  Step 1: Add new payment type values and convert deprecated ones
  - Remove CARTAO
  - Add CARTAO_CREDITO, DINHEIRO, CARTAO_DEBITO, TRANSFERENCIA, RECEBIDO_EM_DINHEIRO, INDEFINIDO if not exist
*/

-- AlterEnum - Add new values and remove CARTAO
BEGIN;
-- Create new enum with all values (old + new)
CREATE TYPE "FormaPagamento_new" AS ENUM ('DINHEIRO', 'PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'BOLETO', 'TRANSFERENCIA', 'RECEBIDO_EM_DINHEIRO', 'INDEFINIDO');

-- Drop defaults
ALTER TABLE "Cobranca" ALTER COLUMN "formaPagamento" DROP DEFAULT;
ALTER TABLE "Matricula" ALTER COLUMN "formaPagamentoTaxa" DROP DEFAULT;

-- Convert values during type change - CARTAO becomes CARTAO_CREDITO
ALTER TABLE "Matricula" ALTER COLUMN "formaPagamentoTaxa" TYPE "FormaPagamento_new" 
USING (
  CASE 
    WHEN "formaPagamentoTaxa"::text = 'CARTAO' THEN 'CARTAO_CREDITO'::text::"FormaPagamento_new"
    ELSE "formaPagamentoTaxa"::text::"FormaPagamento_new"
  END
);

ALTER TABLE "Cobranca" ALTER COLUMN "formaPagamento" TYPE "FormaPagamento_new" 
USING (
  CASE 
    WHEN "formaPagamento"::text = 'CARTAO' THEN 'CARTAO_CREDITO'::text::"FormaPagamento_new"
    ELSE "formaPagamento"::text::"FormaPagamento_new"
  END
);

-- Rename types
ALTER TYPE "FormaPagamento" RENAME TO "FormaPagamento_old";
ALTER TYPE "FormaPagamento_new" RENAME TO "FormaPagamento";
DROP TYPE "FormaPagamento_old";

-- Restore defaults
ALTER TABLE "Cobranca" ALTER COLUMN "formaPagamento" SET DEFAULT 'BOLETO';
ALTER TABLE "Matricula" ALTER COLUMN "formaPagamentoTaxa" SET DEFAULT 'BOLETO';
COMMIT;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TipoCobranca" ADD VALUE IF NOT EXISTS 'PARCELADA';
ALTER TYPE "TipoCobranca" ADD VALUE IF NOT EXISTS 'RECORRENTE';
