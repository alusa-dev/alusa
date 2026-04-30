-- Add notification preference flags to Usuario
ALTER TABLE "Usuario"
  ADD COLUMN "notifyEmailProduct" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notifyEmailSecurity" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notifyEmailMarketing" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "notifyWhatsapp" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notifySms" BOOLEAN NOT NULL DEFAULT false;
