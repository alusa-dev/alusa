BEGIN;

-- The previous backfill treated dataInicio as an instant and converted it to
-- the tenant timezone. Alusa stores this field using a UTC civil-date
-- convention; eligibility compares that stored date with the tenant's current
-- academic date. Revert only rows proven to have been changed by that exact
-- backfill and whose stored start date is still in the tenant's future.
WITH premature AS (
  SELECT
    v."contaId",
    v."id" AS "vinculoAcademicoId",
    v."vigenciaIniciadaEm"
  FROM "MatriculaVinculoAcademico" v
  JOIN "Matricula" m
    ON m."contaId" = v."contaId"
   AND m."id" = v."matriculaId"
  JOIN "Conta" c ON c."id" = v."contaId"
  JOIN "MatriculaVinculoAcademicoAudit" a
    ON a."contaId" = v."contaId"
   AND a."vinculoAcademicoId" = v."id"
   AND (
     (
       a."id" = 'legacy-vigency-' || md5(v."contaId" || ':' || v."id" || ':declared-start-v1')
       AND a."autorId" = 'SYSTEM_LEGACY_VIGENCIA_BACKFILL'
       AND a."motivo" = 'LEGACY_VIGENCIA_RECONHECIDA_DATA_INICIO_DECLARADA; CLASSIFICACAO_PRESERVADA_INDETERMINADA'
     ) OR (
       a."id" = 'legacy-vigency-datefix-eligible-' || md5(v."contaId" || ':' || v."id" || ':utc-civil-date-v1')
       AND a."autorId" = 'SYSTEM_LEGACY_VIGENCIA_TIMEZONE_CORRECTION'
       AND a."motivo" = 'LEGACY_VIGENCIA_RECONHECIDA_DATA_CIVIL_UTC; CLASSIFICACAO_PRESERVADA_INDETERMINADA'
     )
   )
  WHERE v."vigenciaIniciadaEm" = m."dataInicio"
    AND m."dataInicio"::date
      > (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(c."timezone", ''), 'UTC'))::date
), reverted AS (
  UPDATE "MatriculaVinculoAcademico" v
  SET "vigenciaIniciadaEm" = NULL,
      "updatedAt" = CURRENT_TIMESTAMP
  FROM premature p
  WHERE v."contaId" = p."contaId"
    AND v."id" = p."vinculoAcademicoId"
    AND v."vigenciaIniciadaEm" = p."vigenciaIniciadaEm"
  RETURNING v."contaId", v."id" AS "vinculoAcademicoId", p."vigenciaIniciadaEm"
)
INSERT INTO "MatriculaVinculoAcademicoAudit" (
  "id", "contaId", "vinculoAcademicoId", "vigenciaIniciadaEmAnterior",
  "vigenciaIniciadaEmNova", "motivo", "autorId", "createdAt"
)
SELECT
  'legacy-vigency-civil-v2-revert-' || md5(r."contaId" || ':' || r."vinculoAcademicoId" || ':utc-civil-date-v2'),
  r."contaId",
  r."vinculoAcademicoId",
  r."vigenciaIniciadaEm",
  NULL,
  'LEGACY_VIGENCIA_REVERTIDA_DATA_CIVIL_UTC_AINDA_FUTURA_NO_TIMEZONE_DA_CONTA',
  'SYSTEM_LEGACY_VIGENCIA_CIVIL_DATE_CORRECTION',
  CURRENT_TIMESTAMP
FROM reverted r
ON CONFLICT ("id") DO NOTHING;

-- Backfill any links which are eligible under Alusa's established date-only
-- semantics. Classification remains indeterminate because this proves only
-- that the contractual start date was reached, not cycle or continuity.
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
    AND m."dataInicio"::date
      <= (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(NULLIF(c."timezone", ''), 'UTC'))::date
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
  'legacy-vigency-civil-v2-eligible-' || md5(u."contaId" || ':' || u."vinculoAcademicoId" || ':utc-civil-date-v2'),
  u."contaId",
  u."vinculoAcademicoId",
  NULL,
  u."vigenciaIniciadaEm",
  'LEGACY_VIGENCIA_RECONHECIDA_DATA_CIVIL_UTC; CLASSIFICACAO_PRESERVADA_INDETERMINADA',
  'SYSTEM_LEGACY_VIGENCIA_CIVIL_DATE_CORRECTION',
  CURRENT_TIMESTAMP
FROM updated u
ON CONFLICT ("id") DO NOTHING;

COMMIT;
