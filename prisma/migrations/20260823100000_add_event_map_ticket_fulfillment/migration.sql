CREATE TYPE "EventMapTicketFulfillmentStatus" AS ENUM ('PENDING', 'ISSUED', 'FAILED', 'REQUIRES_RECONCILIATION');

ALTER TABLE "EventMapOrder"
  ADD COLUMN "ticketFulfillmentStatus" "EventMapTicketFulfillmentStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "ticketFulfillmentAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "ticketFulfillmentLastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "ticketFulfillmentLastError" TEXT,
  ADD COLUMN "ticketFulfilledAt" TIMESTAMP(3);

UPDATE "EventMapOrder" AS o
SET
  "ticketFulfillmentStatus" = 'ISSUED',
  "ticketFulfilledAt" = COALESCE(o."confirmedAt", o."updatedAt")
WHERE o."status" = 'CONFIRMED'
  AND EXISTS (
    SELECT 1
    FROM "EventMapOrderItem" AS i
    WHERE i."orderId" = o."id"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "EventMapOrderItem" AS i
    LEFT JOIN "EventTicket" AS t ON t."orderItemId" = i."id"
    WHERE i."orderId" = o."id"
      AND t."id" IS NULL
  );

CREATE INDEX "idx_event_map_order_conta_fulfillment"
  ON "EventMapOrder"("contaId", "status", "ticketFulfillmentStatus", "updatedAt");
