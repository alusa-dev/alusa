-- Align local NFS-e service snapshot with the official Asaas invoice payload.
CREATE TYPE "FiscalServiceSource" AS ENUM ('MUNICIPAL_LIST', 'MANUAL');

ALTER TABLE "FiscalService"
  ADD COLUMN "source" "FiscalServiceSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN "taxSituationCode" TEXT,
  ADD COLUMN "taxClassificationCode" TEXT,
  ADD COLUMN "operationIndicatorCode" TEXT,
  ADD COLUMN "pisCofinsTaxStatus" TEXT,
  ADD COLUMN "operationPis" DECIMAL(5, 2),
  ADD COLUMN "operationCofins" DECIMAL(5, 2),
  ADD COLUMN "useTaxSystemReformNT007" BOOLEAN NOT NULL DEFAULT false;

UPDATE "FiscalService"
SET "source" = 'MUNICIPAL_LIST'
WHERE "asaasMunicipalServiceId" IS NOT NULL;
