/*
  Warnings:

  - A unique constraint covering the columns `[eventId]` on the table `WebhookAsaas` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "WebhookAsaas" ADD COLUMN     "eventId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "WebhookAsaas_eventId_key" ON "WebhookAsaas"("eventId");
