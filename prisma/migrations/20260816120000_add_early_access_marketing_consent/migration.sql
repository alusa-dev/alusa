-- Add explicit consent for promotional communications.
ALTER TABLE "EarlyAccessLead"
ADD COLUMN "marketingConsent" BOOLEAN NOT NULL DEFAULT false;
