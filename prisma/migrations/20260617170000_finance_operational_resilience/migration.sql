-- Read models operacionais para reduzir leituras diretas no Asaas em telas críticas.

CREATE TABLE "FinancialTransactionSnapshot" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "asaasTransactionId" TEXT NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "balance" DECIMAL(12,2),
    "type" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "externalReference" TEXT,
    "paymentId" TEXT,
    "splitId" TEXT,
    "transferId" TEXT,
    "anticipationId" TEXT,
    "billId" TEXT,
    "invoiceId" TEXT,
    "paymentDunningId" TEXT,
    "creditBureauReportId" TEXT,
    "raw" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialTransactionSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinancialTransactionSyncWindow" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "windowKey" TEXT NOT NULL,
    "startDate" TEXT,
    "finishDate" TEXT,
    "order" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "officialTotalCount" INTEGER NOT NULL DEFAULT 0,
    "fetchedCount" INTEGER NOT NULL DEFAULT 0,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialTransactionSyncWindow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReceivableAnticipationSnapshot" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "asaasAnticipationId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "paymentId" TEXT,
    "installmentId" TEXT,
    "anticipationDate" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "requestDate" TIMESTAMP(3),
    "fee" DECIMAL(12,2),
    "anticipationDays" INTEGER,
    "netValue" DECIMAL(12,2),
    "totalValue" DECIMAL(12,2),
    "value" DECIMAL(12,2),
    "denialObservation" TEXT,
    "source" TEXT NOT NULL,
    "sourceWebhookId" TEXT,
    "eventId" TEXT,
    "raw" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReceivableAnticipationSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_fin_tx_snapshot_conta_asaas" ON "FinancialTransactionSnapshot"("contaId", "asaasTransactionId");
CREATE INDEX "idx_fin_tx_snapshot_conta_date" ON "FinancialTransactionSnapshot"("contaId", "date");
CREATE INDEX "idx_fin_tx_snapshot_conta_type_date" ON "FinancialTransactionSnapshot"("contaId", "type", "date");
CREATE INDEX "idx_fin_tx_snapshot_conta_payment" ON "FinancialTransactionSnapshot"("contaId", "paymentId");
CREATE INDEX "idx_fin_tx_snapshot_conta_transfer" ON "FinancialTransactionSnapshot"("contaId", "transferId");
CREATE INDEX "idx_fin_tx_snapshot_conta_anticipation" ON "FinancialTransactionSnapshot"("contaId", "anticipationId");

CREATE UNIQUE INDEX "uq_fin_tx_sync_window_conta_key" ON "FinancialTransactionSyncWindow"("contaId", "windowKey");
CREATE INDEX "idx_fin_tx_sync_window_conta_synced" ON "FinancialTransactionSyncWindow"("contaId", "syncedAt");

CREATE UNIQUE INDEX "uq_receivable_anticipation_conta_asaas" ON "ReceivableAnticipationSnapshot"("contaId", "asaasAnticipationId");
CREATE INDEX "idx_receivable_anticipation_conta_status" ON "ReceivableAnticipationSnapshot"("contaId", "status");
CREATE INDEX "idx_receivable_anticipation_conta_payment" ON "ReceivableAnticipationSnapshot"("contaId", "paymentId");
CREATE INDEX "idx_receivable_anticipation_conta_installment" ON "ReceivableAnticipationSnapshot"("contaId", "installmentId");
CREATE INDEX "idx_receivable_anticipation_conta_status_updated" ON "ReceivableAnticipationSnapshot"("contaId", "statusUpdatedAt");

ALTER TABLE "FinancialTransactionSnapshot" ADD CONSTRAINT "FinancialTransactionSnapshot_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialTransactionSyncWindow" ADD CONSTRAINT "FinancialTransactionSyncWindow_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReceivableAnticipationSnapshot" ADD CONSTRAINT "ReceivableAnticipationSnapshot_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
