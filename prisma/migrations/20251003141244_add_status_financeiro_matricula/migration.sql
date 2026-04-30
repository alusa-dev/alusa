-- CreateEnum
CREATE TYPE "StatusFinanceiro" AS ENUM ('ADIMPLENTE', 'PENDENTE_TAXA', 'INADIMPLENTE');

-- AlterTable
ALTER TABLE "Cobranca" ADD COLUMN     "dataPagamento" TIMESTAMP(3),
ADD COLUMN     "descricao" TEXT;

-- AlterTable
ALTER TABLE "Matricula" ADD COLUMN     "statusFinanceiro" "StatusFinanceiro" NOT NULL DEFAULT 'PENDENTE_TAXA',
ALTER COLUMN "status" SET DEFAULT 'ATIVA';
