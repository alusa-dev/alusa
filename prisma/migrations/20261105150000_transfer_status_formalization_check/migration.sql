ALTER TABLE "TransferenciaAcademicaVinculo"
  ADD CONSTRAINT "ck_transferencia_academica_status_formalizacao"
  CHECK (
    (
      "status" = 'PENDENTE'
      AND "formalizadaEm" IS NULL
      AND "formalizadaPor" IS NULL
      AND "solicitadaPor" IS NOT NULL
    )
    OR
    (
      "status" = 'FORMALIZADA'
      AND "formalizadaEm" IS NOT NULL
      AND "formalizadaPor" IS NOT NULL
    )
  );
