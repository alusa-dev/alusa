-- Permite nova rematrícula para o mesmo vínculo/período após cancelamento,
-- mantendo bloqueio de duplicidade para itens ativos.
ALTER TABLE "RematriculaItem" DROP CONSTRAINT IF EXISTS "uq_rematricula_item_conta_origem_period";
DROP INDEX IF EXISTS "uq_rematricula_item_conta_origem_period";

CREATE UNIQUE INDEX "uq_rematricula_item_conta_origem_period_active"
  ON "RematriculaItem"("contaId", "matriculaOrigemId", "targetPeriodId")
  WHERE "status" <> 'CANCELLED';
