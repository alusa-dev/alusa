DO $$
BEGIN
  CREATE TYPE "AulasOperationLogLevel" AS ENUM ('INFO', 'WARNING', 'ERROR');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "AulasOperationLog" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "level" "AulasOperationLogLevel" NOT NULL DEFAULT 'INFO',
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "message" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AulasOperationLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_aulas_operation_log_conta_created" ON "AulasOperationLog"("contaId", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_aulas_operation_log_conta_action" ON "AulasOperationLog"("contaId", "action");
CREATE INDEX IF NOT EXISTS "idx_aulas_operation_log_entity" ON "AulasOperationLog"("entityType", "entityId");

DO $$
BEGIN
  ALTER TABLE "AulasOperationLog"
    ADD CONSTRAINT "AulasOperationLog_contaId_fkey"
    FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
