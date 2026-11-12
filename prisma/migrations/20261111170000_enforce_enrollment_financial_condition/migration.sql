ALTER TABLE "Matricula"
  ADD CONSTRAINT "Matricula_condicao_financeira_details_check"
  CHECK (
    ("condicaoFinanceira" = 'NORMAL'
      AND "condicaoPercentual" IS NULL
      AND "condicaoMotivo" IS NULL
      AND "condicaoValidaAte" IS NULL)
    OR
    ("condicaoFinanceira" = 'BOLSA_PARCIAL'
      AND "condicaoPercentual" IS NOT NULL
      AND "condicaoPercentual" > 0
      AND "condicaoPercentual" < 100
      AND NULLIF(BTRIM("condicaoMotivo"), '') IS NOT NULL
      AND "condicaoValidaAte" IS NOT NULL)
    OR
    ("condicaoFinanceira" = 'ISENCAO_INTEGRAL'
      AND "condicaoPercentual" IS NULL
      AND NULLIF(BTRIM("condicaoMotivo"), '') IS NOT NULL
      AND "condicaoValidaAte" IS NOT NULL)
  );
