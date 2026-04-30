/*
  Warnings:

  - Made the column `idempotencyKey` on table `TransferRequest` required. This step will fail if there are existing NULL values in that column.

*/

-- Backfill para evitar falha em ambientes com dados legados
UPDATE "TransferRequest"
SET "idempotencyKey" = CONCAT('legacy:', "id")
WHERE "idempotencyKey" IS NULL;

-- AlterTable
ALTER TABLE "TransferRequest" ALTER COLUMN "idempotencyKey" SET NOT NULL;
