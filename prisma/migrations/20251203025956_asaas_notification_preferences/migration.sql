-- CreateEnum
CREATE TYPE "AsaasNotificationEvent" AS ENUM ('PAYMENT_CREATED', 'PAYMENT_UPDATED', 'PAYMENT_DUEDATE_WARNING', 'SEND_LINHA_DIGITAVEL', 'PAYMENT_OVERDUE', 'PAYMENT_RECEIVED');

-- CreateTable
CREATE TABLE "AsaasNotificationPreference" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "event" "AsaasNotificationEvent" NOT NULL,
    "scheduleOffset" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "emailEnabledForProvider" BOOLEAN NOT NULL DEFAULT false,
    "smsEnabledForProvider" BOOLEAN NOT NULL DEFAULT false,
    "emailEnabledForCustomer" BOOLEAN NOT NULL DEFAULT true,
    "smsEnabledForCustomer" BOOLEAN NOT NULL DEFAULT true,
    "whatsappEnabledForCustomer" BOOLEAN NOT NULL DEFAULT false,
    "phoneCallEnabledForCustomer" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AsaasNotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AsaasNotificationPreference_contaId_idx" ON "AsaasNotificationPreference"("contaId");

-- CreateIndex
CREATE UNIQUE INDEX "AsaasNotificationPreference_contaId_event_scheduleOffset_key" ON "AsaasNotificationPreference"("contaId", "event", "scheduleOffset");

-- AddForeignKey
ALTER TABLE "AsaasNotificationPreference" ADD CONSTRAINT "AsaasNotificationPreference_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
