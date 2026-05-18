-- Add a first-run flag for the dashboard welcome wizard.
ALTER TABLE "Usuario"
ADD COLUMN "welcomeWizardSeenAt" TIMESTAMP(3);

-- Existing users should not receive the new-user welcome flow retroactively.
UPDATE "Usuario"
SET "welcomeWizardSeenAt" = NOW()
WHERE "welcomeWizardSeenAt" IS NULL;