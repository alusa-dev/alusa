-- Add optional photo storage for guardians.
-- IF NOT EXISTS keeps local/staging databases safe if the column was added manually.
ALTER TABLE "Responsavel" ADD COLUMN IF NOT EXISTS "foto" TEXT;
