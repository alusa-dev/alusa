ALTER TABLE "ExpertContactLeadDelivery"
  ADD COLUMN IF NOT EXISTS "institutionWebsite" TEXT;

ALTER TABLE "ExpertContactLeadDelivery"
  DROP CONSTRAINT IF EXISTS "ExpertContactLeadDelivery_expired_is_redacted";

ALTER TABLE "ExpertContactLeadDelivery"
  ADD CONSTRAINT "ExpertContactLeadDelivery_expired_is_redacted" CHECK (
    "state" <> 'EXPIRED' OR (
      "contactName" IS NULL AND
      "email" IS NULL AND
      "institutionName" IS NULL AND
      "institutionWebsite" IS NULL AND
      "phone" IS NULL AND
      "institutionType" IS NULL AND
      "studentsRange" IS NULL AND
      "payloadHash" IS NULL
    )
  );
