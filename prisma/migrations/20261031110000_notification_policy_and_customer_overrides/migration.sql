ALTER TABLE "Conta"
  ADD COLUMN "customerNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "contractWhatsAppNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notificationPolicyVersion" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "AsaasNotificationPreference"
  ADD COLUMN "customerEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "AsaasNotificationPreferenceOutbox"
  ADD COLUMN "policyVersion" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "AsaasCustomerNotificationOverride" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "asaasCustomerId" TEXT NOT NULL,
  "event" "AsaasNotificationEvent" NOT NULL,
  "scheduleOffset" INTEGER NOT NULL DEFAULT 0,
  "customerEnabled" BOOLEAN,
  "emailEnabledForCustomer" BOOLEAN,
  "smsEnabledForCustomer" BOOLEAN,
  "whatsappEnabledForCustomer" BOOLEAN,
  "phoneCallEnabledForCustomer" BOOLEAN,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AsaasCustomerNotificationOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uq_asaas_customer_notification_override"
  ON "AsaasCustomerNotificationOverride"("contaId", "asaasCustomerId", "event", "scheduleOffset");
CREATE INDEX "idx_asaas_customer_notification_override_customer"
  ON "AsaasCustomerNotificationOverride"("contaId", "asaasCustomerId");

ALTER TABLE "AsaasCustomerNotificationOverride"
  ADD CONSTRAINT "AsaasCustomerNotificationOverride_contaId_fkey"
  FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE SCHEMA IF NOT EXISTS app_security;
CREATE OR REPLACE FUNCTION app_security.current_conta_id()
RETURNS text LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.current_conta_id', true), '')
$$;

ALTER TABLE "AsaasCustomerNotificationOverride" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AsaasCustomerNotificationOverride" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AsaasCustomerNotificationOverride_tenant_isolation"
  ON "AsaasCustomerNotificationOverride"
  USING ("contaId" = app_security.current_conta_id())
  WITH CHECK ("contaId" = app_security.current_conta_id());
