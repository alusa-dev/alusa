-- Legacy links can have an active enrollment and a reached contractual start
-- date even though the original activation timestamp was never recorded.
-- Recognize the declared academic start date as vigency; do not infer cycle or
-- continuity, so the existing HISTORICO_INDETERMINADO classification is kept.
-- For REQUIRES_PAYMENT, require persisted proof that the fee was paid, waived,
-- exempt, or absent. IMMEDIATE follows the account's activation policy.
WITH eligible AS (
  SELECT
    v."contaId",
    v."id" AS "vinculoAcademicoId",
    m."dataInicio" AS "vigenciaIniciadaEm"
  FROM "MatriculaVinculoAcademico" v
  JOIN "Matricula" m
    ON m."contaId" = v."contaId"
   AND m."id" = v."matriculaId"
  JOIN "Conta" c ON c."id" = v."contaId"
  WHERE v."vigenciaIniciadaEm" IS NULL
    AND m."status" = 'ATIVA'::"StatusMatricula"
    AND (
      (m."dataInicio" AT TIME ZONE 'UTC') AT TIME ZONE COALESCE(NULLIF(c."timezone", ''), 'UTC')
    )::date <= (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(c."timezone", ''), 'UTC'))::date
    AND (
      c."matriculaActivationPolicy" = 'IMMEDIATE'::"MatriculaActivationPolicy"
      OR (
        c."matriculaActivationPolicy" = 'REQUIRES_PAYMENT'::"MatriculaActivationPolicy"
        AND (
          m."taxaStatus" IN ('PAGO'::"StatusTaxaMatricula", 'ISENTO'::"StatusTaxaMatricula")
          OR m."taxaIsenta" = TRUE
          OR m."taxaMatricula" <= 0
        )
      )
    )
), updated AS (
  UPDATE "MatriculaVinculoAcademico" v
  SET "vigenciaIniciadaEm" = eligible."vigenciaIniciadaEm",
      "updatedAt" = CURRENT_TIMESTAMP
  FROM eligible
  WHERE v."contaId" = eligible."contaId"
    AND v."id" = eligible."vinculoAcademicoId"
    AND v."vigenciaIniciadaEm" IS NULL
  RETURNING v."contaId", v."id" AS "vinculoAcademicoId", v."vigenciaIniciadaEm"
)
INSERT INTO "MatriculaVinculoAcademicoAudit" (
  "id", "contaId", "vinculoAcademicoId", "vigenciaIniciadaEmAnterior",
  "vigenciaIniciadaEmNova", "motivo", "autorId", "createdAt"
)
SELECT
  'legacy-vigency-' || md5(updated."contaId" || ':' || updated."vinculoAcademicoId" || ':declared-start-v1'),
  updated."contaId",
  updated."vinculoAcademicoId",
  NULL,
  updated."vigenciaIniciadaEm",
  'LEGACY_VIGENCIA_RECONHECIDA_DATA_INICIO_DECLARADA; CLASSIFICACAO_PRESERVADA_INDETERMINADA',
  'SYSTEM_LEGACY_VIGENCIA_BACKFILL',
  CURRENT_TIMESTAMP
FROM updated
ON CONFLICT ("id") DO NOTHING;
