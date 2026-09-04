-- Classifies event costs so gross and net results can be calculated separately.
CREATE TYPE "EventFinancialCostClass" AS ENUM ('DIRECT', 'INDIRECT', 'FINANCIAL', 'TAX');

ALTER TABLE "EventFinancialEntry"
  ADD COLUMN "costClass" "EventFinancialCostClass" NOT NULL DEFAULT 'DIRECT';

CREATE INDEX "idx_event_financial_entry_conta_event_cost_class"
  ON "EventFinancialEntry"("contaId", "eventId", "type", "costClass", "status");
