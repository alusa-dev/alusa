-- Allow historical records to outlive the user who created them.
-- The user-management delete operation can therefore remove Usuario physically
-- without deleting financial, operational, or audit history.

ALTER TABLE "CheckoutLink" ALTER COLUMN "createdById" DROP NOT NULL;
ALTER TABLE "LogFinanceiro" ALTER COLUMN "usuarioId" DROP NOT NULL;
ALTER TABLE "PayerChangeOperacao" ALTER COLUMN "createdById" DROP NOT NULL;
ALTER TABLE "Sale" ALTER COLUMN "operadorId" DROP NOT NULL;
ALTER TABLE "RestockOrder" ALTER COLUMN "createdById" DROP NOT NULL;

ALTER TABLE "CheckoutLink" DROP CONSTRAINT IF EXISTS "CheckoutLink_createdById_fkey";
ALTER TABLE "CheckoutLink"
  ADD CONSTRAINT "CheckoutLink_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LogFinanceiro" DROP CONSTRAINT IF EXISTS "LogFinanceiro_usuarioId_fkey";
ALTER TABLE "LogFinanceiro"
  ADD CONSTRAINT "LogFinanceiro_usuarioId_fkey"
  FOREIGN KEY ("usuarioId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PayerChangeOperacao" DROP CONSTRAINT IF EXISTS "PayerChangeOperacao_createdById_fkey";
ALTER TABLE "PayerChangeOperacao"
  ADD CONSTRAINT "PayerChangeOperacao_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Sale" DROP CONSTRAINT IF EXISTS "Sale_operadorId_fkey";
ALTER TABLE "Sale"
  ADD CONSTRAINT "Sale_operadorId_fkey"
  FOREIGN KEY ("operadorId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RestockOrder" DROP CONSTRAINT IF EXISTS "RestockOrder_createdById_fkey";
ALTER TABLE "RestockOrder"
  ADD CONSTRAINT "RestockOrder_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
