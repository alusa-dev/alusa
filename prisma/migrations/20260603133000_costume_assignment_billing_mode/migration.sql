CREATE TYPE "EventCostumeAssignmentBillingMode" AS ENUM (
  'INCLUDED_IN_REGISTRATION_FEE',
  'SEPARATE_CHARGE',
  'FREE'
);

ALTER TABLE "EventCostumeAssignment"
  ADD COLUMN "billingMode" "EventCostumeAssignmentBillingMode";

UPDATE "EventCostumeAssignment"
SET "billingMode" = CASE
  WHEN "revenueEntryId" IS NOT NULL THEN 'SEPARATE_CHARGE'::"EventCostumeAssignmentBillingMode"
  WHEN COALESCE("chargedValue", 0) > 0 THEN 'INCLUDED_IN_REGISTRATION_FEE'::"EventCostumeAssignmentBillingMode"
  ELSE 'FREE'::"EventCostumeAssignmentBillingMode"
END
WHERE "billingMode" IS NULL;

ALTER TABLE "EventCostumeAssignment"
  ALTER COLUMN "billingMode" SET NOT NULL,
  ALTER COLUMN "billingMode" SET DEFAULT 'SEPARATE_CHARGE';

