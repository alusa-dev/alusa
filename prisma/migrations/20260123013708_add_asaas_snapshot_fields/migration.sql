-- CreateEnum
CREATE TYPE "LiquidacaoStatus" AS ENUM ('NAO_APLICAVEL', 'PENDENTE', 'DISPONIVEL');

-- AlterTable
ALTER TABLE "Cobranca" ADD COLUMN     "asaasCreditDate" TIMESTAMP(3),
ADD COLUMN     "asaasEstimatedCreditDate" TIMESTAMP(3),
ADD COLUMN     "asaasFeeValue" DECIMAL(12,2),
ADD COLUMN     "asaasNetValue" DECIMAL(12,2),
ADD COLUMN     "asaasOriginalValue" DECIMAL(12,2),
ADD COLUMN     "asaasStatus" TEXT,
ADD COLUMN     "asaasValue" DECIMAL(12,2),
ADD COLUMN     "lastAsaasFetchAt" TIMESTAMP(3),
ADD COLUMN     "lastAsaasFetchHash" TEXT,
ADD COLUMN     "liquidacaoStatus" "LiquidacaoStatus" NOT NULL DEFAULT 'NAO_APLICAVEL',
ADD COLUMN     "liquidadoEm" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "idx_cobranca_last_asaas_fetch" ON "Cobranca"("lastAsaasFetchAt");
