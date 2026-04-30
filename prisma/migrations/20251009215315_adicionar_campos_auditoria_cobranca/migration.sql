-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "StatusCobranca" ADD VALUE IF NOT EXISTS 'A_VENCER';
ALTER TYPE "StatusCobranca" ADD VALUE IF NOT EXISTS 'ESTORNADO_PARCIAL';

-- AlterTable
ALTER TABLE "Cobranca" ADD COLUMN     "canceladoEm" TIMESTAMP(3),
ADD COLUMN     "canceladoMotivo" TEXT,
ADD COLUMN     "canceladoPor" TEXT,
ADD COLUMN     "estornadoEm" TIMESTAMP(3),
ADD COLUMN     "estornadoMotivo" TEXT,
ADD COLUMN     "estornadoPor" TEXT,
ADD COLUMN     "estornadoValor" DECIMAL(12,2),
ADD COLUMN     "pagoEm" TIMESTAMP(3),
ADD COLUMN     "pagoPor" TEXT;
