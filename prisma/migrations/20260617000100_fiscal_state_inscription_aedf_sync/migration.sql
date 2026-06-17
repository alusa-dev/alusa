-- Campos fiscais condicionais (municipalOptions) + sync do Portal Nacional.
DO $$ BEGIN
  CREATE TYPE "FiscalSyncStatus" AS ENUM ('SYNCED', 'PENDING', 'DIVERGED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "ContaFiscalSettings"
  ADD COLUMN IF NOT EXISTS "stateInscription" TEXT,
  ADD COLUMN IF NOT EXISTS "aedf" TEXT,
  ADD COLUMN IF NOT EXISTS "useNationalPortal" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "lastSyncError" TEXT;

ALTER TABLE "ContaFiscalSettings"
  ADD COLUMN IF NOT EXISTS "syncStatus" "FiscalSyncStatus" NOT NULL DEFAULT 'SYNCED';
