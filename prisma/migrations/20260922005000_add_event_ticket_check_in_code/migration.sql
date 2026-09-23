ALTER TABLE "EventTicket"
ADD COLUMN "checkInCode" TEXT;

CREATE UNIQUE INDEX "uq_event_ticket_conta_check_in_code"
ON "EventTicket"("contaId", "checkInCode");
