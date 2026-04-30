-- CreateEnum
CREATE TYPE "RematriculaOperacaoStep" AS ENUM ('VALIDATED', 'NEW_MATRICULA_CREATED', 'SUBSCRIPTION_CREATED', 'ORIGIN_CANCELLED', 'COMPLETED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RematriculaOperacaoStatus" ADD VALUE 'COMMITTED';
ALTER TYPE "RematriculaOperacaoStatus" ADD VALUE 'CANCELLED';

-- AlterTable
ALTER TABLE "RematriculaOperacao" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "lastRetryAt" TIMESTAMP(3),
ADD COLUMN     "retryCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "step" "RematriculaOperacaoStep" NOT NULL DEFAULT 'VALIDATED';
