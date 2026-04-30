-- CreateEnum
CREATE TYPE "StatusContrato" AS ENUM ('ATIVO', 'ENCERRADO');

-- AlterTable
ALTER TABLE "Matricula" ADD COLUMN     "dataFimContrato" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "statusContrato" "StatusContrato" NOT NULL DEFAULT 'ATIVO';

-- CreateIndex
CREATE INDEX "idx_matricula_status_contrato" ON "Matricula"("statusContrato");

-- CreateIndex
CREATE INDEX "idx_matricula_fim_contrato" ON "Matricula"("dataFimContrato");
