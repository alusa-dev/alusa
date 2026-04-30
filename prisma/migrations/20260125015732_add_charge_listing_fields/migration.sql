-- AlterTable
ALTER TABLE "Charge" ADD COLUMN     "billingType" TEXT,
ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "dueDate" TIMESTAMP(3),
ADD COLUMN     "payerName" TEXT,
ADD COLUMN     "value" DECIMAL(12,2);

-- CreateIndex
CREATE INDEX "Charge_customerId_idx" ON "Charge"("customerId");

-- AddForeignKey
ALTER TABLE "Charge" ADD CONSTRAINT "Charge_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
