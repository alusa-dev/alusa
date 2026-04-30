ALTER TABLE "Sale"
ADD COLUMN "uiRequestId" TEXT;

CREATE UNIQUE INDEX "Sale_contaId_uiRequestId_key"
ON "Sale"("contaId", "uiRequestId");