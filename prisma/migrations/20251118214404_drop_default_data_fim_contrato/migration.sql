-- Backfill contract end date using existing columns before removing default
UPDATE "Matricula"
SET "dataFimContrato" = COALESCE("dataFim", "dataInicio")
WHERE "dataInicio" IS NOT NULL;

-- Remove the temporary default now that values are populated deterministically
ALTER TABLE "Matricula" ALTER COLUMN "dataFimContrato" DROP DEFAULT;
