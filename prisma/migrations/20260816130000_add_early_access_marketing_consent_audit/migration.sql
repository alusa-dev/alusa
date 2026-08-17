-- Store consent evidence for promotional communications.
ALTER TABLE "EarlyAccessLead"
ADD COLUMN "marketingConsentAt" TIMESTAMP(3),
ADD COLUMN "marketingConsentIp" TEXT,
ADD COLUMN "marketingConsentUserAgent" TEXT;
