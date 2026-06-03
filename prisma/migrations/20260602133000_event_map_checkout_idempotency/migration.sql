ALTER TABLE "EventMapOrder"
  ALTER COLUMN "status" SET DEFAULT 'PAYMENT_PENDING';

ALTER TABLE "EventMapReservation"
  ADD COLUMN IF NOT EXISTS "checkoutKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_event_map_reservation_conta_map_checkout_key"
  ON "EventMapReservation"("contaId", "eventMapId", "checkoutKey")
  WHERE "checkoutKey" IS NOT NULL;
