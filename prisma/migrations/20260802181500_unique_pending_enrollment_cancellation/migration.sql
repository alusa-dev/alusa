WITH ranked AS (
  SELECT "id",
         ROW_NUMBER() OVER (
           PARTITION BY "contaId", "matriculaId"
           ORDER BY "createdAt" DESC, "id" DESC
         ) AS row_number
  FROM "MatriculaOperacao"
  WHERE "tipo" = 'CANCELAMENTO'
    AND "status" = 'PENDENTE_SINCRONISMO'
)
UPDATE "MatriculaOperacao" AS operation
SET "status" = 'DIVERGENTE',
    "erro" = COALESCE(operation."erro", 'Operação duplicada preservada para reconciliação.'),
    "updatedAt" = CURRENT_TIMESTAMP
FROM ranked
WHERE operation."id" = ranked."id"
  AND ranked.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_matricula_operacao_cancelamento_pendente"
ON "MatriculaOperacao" ("contaId", "matriculaId")
WHERE "tipo" = 'CANCELAMENTO'
  AND "status" = 'PENDENTE_SINCRONISMO';
