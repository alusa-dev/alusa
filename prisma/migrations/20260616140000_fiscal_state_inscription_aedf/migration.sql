-- Inscrição estadual e AEDF exigidos por algumas prefeituras (usesStateInscription / usesAedf).
ALTER TABLE "ContaFiscalSettings"
ADD COLUMN IF NOT EXISTS "stateInscription" TEXT,
ADD COLUMN IF NOT EXISTS "aedf" TEXT;
