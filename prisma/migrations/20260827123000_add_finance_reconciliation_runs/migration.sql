-- Histórico operacional por tenant da reconciliação financeira.
CREATE TABLE "FinanceReconciliationRun" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "correlationId" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  "durationMs" INTEGER,
  "asaasCalls" INTEGER NOT NULL DEFAULT 0,
  "maxAsaasCalls" INTEGER NOT NULL,
  "budgetExhausted" BOOLEAN NOT NULL DEFAULT false,
  "checkedPayments" INTEGER NOT NULL DEFAULT 0,
  "paymentDrift" INTEGER NOT NULL DEFAULT 0,
  "checkedSubscriptions" INTEGER NOT NULL DEFAULT 0,
  "subscriptionDrift" INTEGER NOT NULL DEFAULT 0,
  "checkedInstallments" INTEGER NOT NULL DEFAULT 0,
  "installmentDrift" INTEGER NOT NULL DEFAULT 0,
  "errors" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FinanceReconciliationRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_fin_reconciliation_run_conta_started"
  ON "FinanceReconciliationRun"("contaId", "startedAt");

CREATE INDEX "idx_fin_reconciliation_run_conta_outcome"
  ON "FinanceReconciliationRun"("contaId", "outcome", "startedAt");

CREATE INDEX "idx_fin_reconciliation_run_correlation"
  ON "FinanceReconciliationRun"("correlationId");

ALTER TABLE "FinanceReconciliationRun"
  ADD CONSTRAINT "FinanceReconciliationRun_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
