ALTER TABLE "PlatformSchoolInvitation"
  ADD COLUMN "customBaseMonthlyAmountCents" INTEGER,
  ADD COLUMN "customIncludedStudentCount" INTEGER,
  ADD COLUMN "customMonthlyOverageAmountCents" INTEGER,
  ADD COLUMN "stripeProductId" TEXT;

-- Preserve legacy fixed custom Prices as base amounts with no additional per-student fee.
UPDATE "PlatformSchoolInvitation"
SET "customBaseMonthlyAmountCents" = "monthlyAmountCents",
    "customIncludedStudentCount" = "studentCount",
    "customMonthlyOverageAmountCents" = 0
WHERE "conditionType" = 'CUSTOM';

ALTER TABLE "PlatformSchoolInvitation"
  ADD CONSTRAINT "PlatformSchoolInvitation_custom_pricing_check" CHECK (
    "conditionType" <> 'CUSTOM' OR (
      "customBaseMonthlyAmountCents" IS NOT NULL AND "customBaseMonthlyAmountCents" > 0 AND
      "customIncludedStudentCount" IS NOT NULL AND "customIncludedStudentCount" >= 1 AND
      "customMonthlyOverageAmountCents" IS NOT NULL AND "customMonthlyOverageAmountCents" >= 0
    )
  );
