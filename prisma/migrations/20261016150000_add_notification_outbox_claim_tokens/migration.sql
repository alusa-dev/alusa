ALTER TABLE "AsaasNotificationPreferenceOutbox"
ADD COLUMN "claimToken" TEXT;

ALTER TABLE "AsaasNotificationSyncOutbox"
ADD COLUMN "claimToken" TEXT;
