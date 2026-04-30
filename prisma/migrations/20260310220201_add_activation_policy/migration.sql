-- CreateEnum
CREATE TYPE "MatriculaActivationPolicy" AS ENUM ('IMMEDIATE', 'REQUIRES_PAYMENT');

-- AlterTable
ALTER TABLE "Conta" ADD COLUMN     "matriculaActivationPolicy" "MatriculaActivationPolicy" NOT NULL DEFAULT 'IMMEDIATE';
