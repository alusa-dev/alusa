CREATE TYPE "MatriculaBillingTerminalIntent" AS ENUM ('RECUSADA', 'CANCELADA');

ALTER TABLE "MatriculaBillingOutbox"
  ADD COLUMN "terminalIntent" "MatriculaBillingTerminalIntent",
  ADD COLUMN "terminalIntentReason" TEXT,
  ADD COLUMN "terminalIntentActorId" TEXT,
  ADD COLUMN "terminalIntentAt" TIMESTAMP(3);
