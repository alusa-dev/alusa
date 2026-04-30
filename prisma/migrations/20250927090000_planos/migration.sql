-- Create enum for plano periodicidade
CREATE TYPE "PeriodicidadePlano" AS ENUM ('MENSAL', 'TRIMESTRAL', 'ANUAL');

-- Ensure numeric precision for valor
ALTER TABLE "Plano"
  ALTER COLUMN "valor" TYPE DECIMAL(12,2) USING "valor"::DECIMAL(12,2);

-- Add periodicidade with default for data migration
ALTER TABLE "Plano"
  ADD COLUMN "periodicidade" "PeriodicidadePlano" NOT NULL DEFAULT 'MENSAL';

-- Rename vencimento column to align with new schema
ALTER TABLE "Plano"
  RENAME COLUMN "vencimentoDia" TO "vencimentoPadrao";

-- Remove legacy frequency column
ALTER TABLE "Plano"
  DROP COLUMN IF EXISTS "frequenciaSemanal";

-- Drop default after data migration (existing rows already set to MENSAL)
ALTER TABLE "Plano"
  ALTER COLUMN "periodicidade" DROP DEFAULT;
