ALTER TABLE "MatriculaBillingOutbox"
  ADD COLUMN IF NOT EXISTS "aggregateType" TEXT NOT NULL DEFAULT 'MATRICULA',
  ADD COLUMN IF NOT EXISTS "aggregateId" TEXT,
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastAttemptAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
  ADD COLUMN IF NOT EXISTS "externalReference" TEXT,
  ADD COLUMN IF NOT EXISTS "correlationId" TEXT;

UPDATE "MatriculaBillingOutbox"
SET
  "aggregateType" = COALESCE(NULLIF("aggregateType", ''), 'MATRICULA'),
  "aggregateId" = COALESCE("aggregateId", "matriculaId"),
  "externalReference" = COALESCE("externalReference", 'matricula:' || "matriculaId" || ':billing'),
  "correlationId" = COALESCE("correlationId", "dedupeKey")
WHERE "matriculaId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_matricula_billing_outbox_conta_aggregate"
  ON "MatriculaBillingOutbox"("contaId", "aggregateType", "aggregateId");

CREATE INDEX IF NOT EXISTS "idx_matricula_billing_outbox_conta_external_ref"
  ON "MatriculaBillingOutbox"("contaId", "externalReference");
