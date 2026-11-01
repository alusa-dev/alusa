ALTER TABLE "Conta"
  ADD COLUMN "customerEmailNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "customerWhatsAppNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "customerSmsNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true;
