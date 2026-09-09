ALTER TABLE "Cobranca"
ADD COLUMN "bankSlipUrl" TEXT,
ADD COLUMN "identificationField" TEXT,
ADD COLUMN "barCode" TEXT,
ADD COLUMN "nossoNumero" TEXT,
ADD COLUMN "bankSlipCancelledAt" TIMESTAMP(3);

ALTER TABLE "Charge"
ADD COLUMN "bankSlipUrl" TEXT,
ADD COLUMN "identificationField" TEXT,
ADD COLUMN "barCode" TEXT,
ADD COLUMN "nossoNumero" TEXT,
ADD COLUMN "bankSlipCancelledAt" TIMESTAMP(3);
