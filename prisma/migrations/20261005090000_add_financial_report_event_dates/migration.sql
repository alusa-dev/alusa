-- Canonical event dates for cash and enrollment reporting. Historical records
-- intentionally remain NULL when the source event date cannot be established.
ALTER TABLE "Charge" ADD COLUMN "paidAt" TIMESTAMP(3);
ALTER TABLE "Matricula" ADD COLUMN "cancelledAt" TIMESTAMP(3);

CREATE INDEX "idx_charge_conta_paid_at" ON "Charge"("contaId", "paidAt");
CREATE INDEX "idx_matricula_conta_status_cancelled_at" ON "Matricula"("contaId", "status", "cancelledAt");
