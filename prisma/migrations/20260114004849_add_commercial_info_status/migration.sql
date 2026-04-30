-- CreateEnum
CREATE TYPE "AsaasCommercialInfoStatus" AS ENUM ('EXPIRING_SOON', 'EXPIRED');

-- AlterTable
ALTER TABLE "AsaasAccount" ADD COLUMN "commercialInfoStatus" "AsaasCommercialInfoStatus";
