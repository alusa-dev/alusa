CREATE UNIQUE INDEX "uq_contrato_futuro_conta_processo_item"
ON "ContratoFuturo"("contaId", "processoId", "itemId");
