-- Repair a partial production application of phase 4.
-- The historical migration is marked as applied, but this nullable column is
-- missing from Cobranca in some environments. Keep the repair idempotent.
ALTER TABLE "Cobranca"
  ADD COLUMN IF NOT EXISTS "lastProviderCheckAt" TIMESTAMP(3);
