ALTER TABLE "Sale" ADD COLUMN "standaloneInstallmentPlanId" TEXT;

ALTER TABLE "Sale" ADD CONSTRAINT "Sale_standaloneInstallmentPlanId_fkey" FOREIGN KEY ("standaloneInstallmentPlanId") REFERENCES "StandaloneInstallmentPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Sale_standaloneInstallmentPlanId_idx" ON "Sale"("standaloneInstallmentPlanId");
