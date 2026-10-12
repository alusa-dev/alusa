ALTER TYPE "WhatsAppOutboundJobStatus" ADD VALUE 'CANCELLED';

ALTER TABLE "EventMapOrder"
  ADD COLUMN "whatsappOptOutAt" TIMESTAMP(3),
  ADD COLUMN "whatsappOptOutSource" VARCHAR(32);

ALTER TABLE "EventTicketSale"
  ADD COLUMN "whatsappOptOutAt" TIMESTAMP(3),
  ADD COLUMN "whatsappOptOutSource" VARCHAR(32);
