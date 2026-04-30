-- Persist recurring billing type on enrollment records
ALTER TABLE "Matricula"
ADD COLUMN "formaPagamento" "FormaPagamento" DEFAULT 'BOLETO';

UPDATE "Matricula"
SET "formaPagamento" = COALESCE("formaPagamento", "formaPagamentoTaxa", 'BOLETO');

-- Allow subscriptions to be created during enrollment finalization before contract generation
ALTER TABLE "Subscription"
ALTER COLUMN "contratoId" DROP NOT NULL;
