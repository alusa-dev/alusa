-- Add role aliases to the existing financial identity without rewriting history.
-- The original Customer role and its remote-id uniqueness remain unchanged.
CREATE TABLE "CustomerPayer" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "payerType" "CustomerPayerType" NOT NULL,
    "payerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerPayer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerPayer_contaId_payerType_payerId_key"
    ON "CustomerPayer"("contaId", "payerType", "payerId");
CREATE INDEX "CustomerPayer_contaId_customerId_idx"
    ON "CustomerPayer"("contaId", "customerId");

ALTER TABLE "CustomerPayer" ADD CONSTRAINT "CustomerPayer_contaId_fkey"
    FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerPayer" ADD CONSTRAINT "CustomerPayer_contaId_customerId_fkey"
    FOREIGN KEY ("contaId", "customerId") REFERENCES "Customer"("contaId", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Deterministic ids and a conflict guard make this backfill safe to rerun.
-- No cross-role identity is inferred from name, contact data or an external id.
-- Application reconciliation verifies CPF and tenant before linking another role.
INSERT INTO "CustomerPayer" (
    "id", "contaId", "customerId", "payerType", "payerId", "createdAt", "updatedAt"
)
SELECT 'customer_payer_' || "id", "contaId", "id", "payerType", "payerId", "createdAt", "updatedAt"
FROM "Customer"
ON CONFLICT ("contaId", "payerType", "payerId") DO NOTHING;

-- Match the existing owner-compatible tenant RLS rollout.
ALTER TABLE "CustomerPayer" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "CustomerPayer"
    USING ("contaId" = app_security.current_conta_id())
    WITH CHECK ("contaId" = app_security.current_conta_id());
