ALTER TABLE "Sale"
ADD COLUMN "requestFingerprint" TEXT;

CREATE INDEX "idx_sale_conta_request_fingerprint"
ON "Sale"("contaId", "requestFingerprint");
