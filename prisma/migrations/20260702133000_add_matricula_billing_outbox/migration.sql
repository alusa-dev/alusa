ALTER TYPE "MatriculaBillingProvisionStatus" ADD VALUE IF NOT EXISTS 'RESULTADO_INCERTO';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MatriculaBillingOutboxStatus') THEN
    CREATE TYPE "MatriculaBillingOutboxStatus" AS ENUM (
      'PENDING',
      'PROCESSING',
      'PROCESSED',
      'FAILED',
      'REQUIRES_RECONCILIATION'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "MatriculaBillingOutbox" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "matriculaId" TEXT,
  "eventType" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "MatriculaBillingOutboxStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "processedAt" TIMESTAMP(3),
  "lastError" TEXT,
  "dedupeKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MatriculaBillingOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_matricula_billing_outbox_conta_dedupe"
  ON "MatriculaBillingOutbox"("contaId", "dedupeKey");

CREATE INDEX IF NOT EXISTS "idx_matricula_billing_outbox_conta_status_available"
  ON "MatriculaBillingOutbox"("contaId", "status", "availableAt");

CREATE INDEX IF NOT EXISTS "idx_matricula_billing_outbox_conta_matricula"
  ON "MatriculaBillingOutbox"("contaId", "matriculaId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MatriculaBillingOutbox_contaId_fkey'
  ) THEN
    ALTER TABLE "MatriculaBillingOutbox"
      ADD CONSTRAINT "MatriculaBillingOutbox_contaId_fkey"
      FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'MatriculaBillingOutbox_matriculaId_fkey'
  ) THEN
    ALTER TABLE "MatriculaBillingOutbox"
      ADD CONSTRAINT "MatriculaBillingOutbox_matriculaId_fkey"
      FOREIGN KEY ("matriculaId") REFERENCES "Matricula"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
