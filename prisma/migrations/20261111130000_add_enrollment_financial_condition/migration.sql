ALTER TABLE "Matricula"
  ADD COLUMN "condicaoFinanceira" TEXT NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "condicaoPercentual" DECIMAL(5,2),
  ADD COLUMN "condicaoMotivo" TEXT,
  ADD COLUMN "condicaoValidaAte" DATE;

ALTER TABLE "Matricula"
  ADD CONSTRAINT "Matricula_condicaoFinanceira_check"
  CHECK ("condicaoFinanceira" IN ('NORMAL', 'BOLSA_PARCIAL', 'ISENCAO_INTEGRAL'));

ALTER TABLE "Matricula"
  ADD CONSTRAINT "Matricula_condicaoPercentual_check"
  CHECK ("condicaoPercentual" IS NULL OR ("condicaoPercentual" > 0 AND "condicaoPercentual" < 100));


CREATE INDEX "idx_matricula_conta_condicao_financeira"
  ON "Matricula"("contaId", "condicaoFinanceira");
