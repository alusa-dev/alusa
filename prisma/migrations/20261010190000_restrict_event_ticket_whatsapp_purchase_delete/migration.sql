ALTER TABLE "EventTicketWhatsAppNotification"
  DROP CONSTRAINT "EventTicketWhatsAppNotification_eventMapOrderId_fkey",
  DROP CONSTRAINT "EventTicketWhatsAppNotification_eventTicketSaleId_fkey";

ALTER TABLE "EventTicketWhatsAppNotification"
  ADD CONSTRAINT "EventTicketWhatsAppNotification_eventMapOrderId_fkey"
    FOREIGN KEY ("eventMapOrderId") REFERENCES "EventMapOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "EventTicketWhatsAppNotification_eventTicketSaleId_fkey"
    FOREIGN KEY ("eventTicketSaleId") REFERENCES "EventTicketSale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "idx_event_ticket_whatsapp_notification_job"
  ON "EventTicketWhatsAppNotification"("whatsappJobId");
