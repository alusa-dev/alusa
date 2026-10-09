ALTER TABLE "EventMap"
  ADD COLUMN "startsAt" TIMESTAMP(3),
  ADD COLUMN "endsAt" TIMESTAMP(3),
  ADD COLUMN "locationName" TEXT,
  ADD COLUMN "locationAddress" TEXT;

ALTER TABLE "EventTicketLot"
  ADD COLUMN "eventMapId" TEXT;

ALTER TABLE "EventTicketLot"
  ADD CONSTRAINT "EventTicketLot_eventMapId_fkey"
  FOREIGN KEY ("eventMapId") REFERENCES "EventMap"("id") ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX IF EXISTS "uq_event_ticket_lot_conta_event_name";
DROP INDEX IF EXISTS "EventTicketLot_contaId_eventId_name_key";
CREATE UNIQUE INDEX "uq_event_ticket_lot_global_name"
  ON "EventTicketLot"("contaId", "eventId", "name")
  WHERE "eventMapId" IS NULL;
CREATE UNIQUE INDEX "uq_event_ticket_lot_map_name"
  ON "EventTicketLot"("contaId", "eventId", "eventMapId", "name")
  WHERE "eventMapId" IS NOT NULL;
CREATE INDEX "idx_event_ticket_lot_conta_map_status"
  ON "EventTicketLot"("contaId", "eventMapId", "status");
