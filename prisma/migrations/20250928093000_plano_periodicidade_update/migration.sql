-- AlterEnum
DO $$
BEGIN
  ALTER TYPE "PeriodicidadePlano" ADD VALUE IF NOT EXISTS 'QUINZENAL';
  ALTER TYPE "PeriodicidadePlano" ADD VALUE IF NOT EXISTS 'SEMANAL';
END $$;

-- AlterTable
ALTER TABLE "Plano" DROP COLUMN IF EXISTS "vencimentoPadrao";
