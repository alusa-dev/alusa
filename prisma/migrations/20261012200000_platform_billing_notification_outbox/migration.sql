CREATE TABLE "PlatformBillingNotificationOutbox" (
  "id" TEXT NOT NULL,
  "environment" "PlatformBillingEnvironment" NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "contaId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lockedAt" TIMESTAMP(3),
  "workerId" TEXT,
  "deliveredAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlatformBillingNotificationOutbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "uq_platform_billing_notification_env_event"
  ON "PlatformBillingNotificationOutbox"("environment", "eventId");
CREATE INDEX "idx_platform_billing_notification_status_next"
  ON "PlatformBillingNotificationOutbox"("status", "nextAttemptAt");
CREATE INDEX "idx_platform_billing_notification_conta_status"
  ON "PlatformBillingNotificationOutbox"("contaId", "status");
