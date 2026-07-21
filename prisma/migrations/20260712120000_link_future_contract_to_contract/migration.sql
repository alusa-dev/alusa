ALTER TABLE "ContratoFuturo"
ADD COLUMN "contratoId" TEXT;

CREATE UNIQUE INDEX "ContratoFuturo_contratoId_key"
ON "ContratoFuturo"("contratoId");

CREATE INDEX "idx_contrato_futuro_conta_contrato"
ON "ContratoFuturo"("contaId", "contratoId");

ALTER TABLE "ContratoFuturo"
ADD CONSTRAINT "ContratoFuturo_contratoId_fkey"
FOREIGN KEY ("contratoId") REFERENCES "Contrato"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
