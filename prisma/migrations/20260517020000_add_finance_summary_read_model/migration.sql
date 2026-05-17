CREATE TABLE "FinanceSummaryReadModel" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "pendingAmountCurrentWindow" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "pendingCountCurrentWindow" INTEGER NOT NULL DEFAULT 0,
  "overdueAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "overdueCount" INTEGER NOT NULL DEFAULT 0,
  "paidAmountMonth" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "paidCountMonth" INTEGER NOT NULL DEFAULT 0,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "windowEnd" TIMESTAMP(3) NOT NULL,
  "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "projectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinanceSummaryReadModel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_finance_summary_conta_window" ON "FinanceSummaryReadModel"("contaId", "windowStart", "windowEnd");
CREATE INDEX "idx_finance_summary_conta_projected" ON "FinanceSummaryReadModel"("contaId", "projectedAt");
CREATE INDEX "idx_finance_summary_conta_window_end" ON "FinanceSummaryReadModel"("contaId", "windowEnd");

ALTER TABLE "FinanceSummaryReadModel" ADD CONSTRAINT "FinanceSummaryReadModel_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
