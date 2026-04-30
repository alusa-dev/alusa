ALTER TABLE "AsaasNotificationPreference"
ADD COLUMN IF NOT EXISTS "whatsappCapabilitySupported" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "whatsappCapabilityLastCheckedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "whatsappCapabilityLastErrorCode" TEXT,
ADD COLUMN IF NOT EXISTS "whatsappCapabilityEnvironment" TEXT;
