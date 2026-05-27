-- Public publication, seat reservation, checkout and ticket delivery for event maps.

CREATE TYPE "EventMapPublicSeatStatus" AS ENUM ('AVAILABLE', 'HELD', 'SOLD', 'BLOCKED', 'UNAVAILABLE');
CREATE TYPE "EventMapReservationStatus" AS ENUM ('HELD', 'EXPIRED', 'CONSUMED', 'CANCELLED');
CREATE TYPE "EventMapOrderStatus" AS ENUM ('CONFIRMED', 'CANCELLED', 'REFUNDED');
CREATE TYPE "EventTicketStatus" AS ENUM ('VALID', 'USED', 'CANCELLED', 'REISSUED');

ALTER TABLE "EventMap"
  ADD COLUMN "publicSlug" TEXT,
  ADD COLUMN "publicEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "EventMapVersion"
  ADD COLUMN "seatCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "publishedByUserId" TEXT,
  ADD COLUMN "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "EventMapPublicSeat" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventMapId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "originalSeatId" TEXT NOT NULL,
  "levelId" TEXT,
  "sectionId" TEXT,
  "sectionName" TEXT NOT NULL,
  "lotId" TEXT,
  "lotName" TEXT,
  "unitPrice" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "technicalCode" TEXT NOT NULL,
  "displayLabel" TEXT NOT NULL,
  "rowLabel" TEXT,
  "seatNumber" TEXT,
  "status" "EventMapPublicSeatStatus" NOT NULL DEFAULT 'AVAILABLE',
  "accessible" BOOLEAN NOT NULL DEFAULT false,
  "publicVisible" BOOLEAN NOT NULL DEFAULT true,
  "x" DECIMAL(12,2) NOT NULL,
  "y" DECIMAL(12,2) NOT NULL,
  "size" DECIMAL(8,2),
  "rotation" DECIMAL(8,2) NOT NULL DEFAULT 0,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EventMapPublicSeat_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventMapReservation" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventMapId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "holdToken" TEXT NOT NULL,
  "status" "EventMapReservationStatus" NOT NULL DEFAULT 'HELD',
  "buyerName" TEXT,
  "buyerEmail" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EventMapReservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventMapReservationSeat" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "publicSeatId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EventMapReservationSeat_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventMapOrder" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventMapId" TEXT NOT NULL,
  "versionId" TEXT NOT NULL,
  "reservationId" TEXT,
  "buyerName" TEXT NOT NULL,
  "buyerEmail" TEXT NOT NULL,
  "buyerDocument" TEXT,
  "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "status" "EventMapOrderStatus" NOT NULL DEFAULT 'CONFIRMED',
  "accessToken" TEXT NOT NULL,
  "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelledAt" TIMESTAMP(3),
  "refundedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EventMapOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventMapOrderItem" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "publicSeatId" TEXT NOT NULL,
  "lotId" TEXT,
  "unitPriceSnapshot" DECIMAL(12,2) NOT NULL DEFAULT 0,
  "sectionName" TEXT NOT NULL,
  "seatLabel" TEXT NOT NULL,
  "technicalCode" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EventMapOrderItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventTicket" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "eventMapOrderId" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "ticketCode" TEXT NOT NULL,
  "status" "EventTicketStatus" NOT NULL DEFAULT 'VALID',
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EventTicket_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventMap_publicSlug_key" ON "EventMap"("publicSlug");
CREATE INDEX "idx_event_map_conta_public_slug" ON "EventMap"("contaId", "publicSlug");

CREATE UNIQUE INDEX "EventMapReservation_holdToken_key" ON "EventMapReservation"("holdToken");
CREATE UNIQUE INDEX "EventMapOrder_reservationId_key" ON "EventMapOrder"("reservationId");
CREATE UNIQUE INDEX "EventMapOrder_accessToken_key" ON "EventMapOrder"("accessToken");
CREATE UNIQUE INDEX "EventTicket_orderItemId_key" ON "EventTicket"("orderItemId");
CREATE UNIQUE INDEX "EventTicket_ticketCode_key" ON "EventTicket"("ticketCode");

CREATE UNIQUE INDEX "uq_event_map_public_seat_conta_version_original" ON "EventMapPublicSeat"("contaId", "versionId", "originalSeatId");
CREATE UNIQUE INDEX "uq_event_map_public_seat_conta_version_code" ON "EventMapPublicSeat"("contaId", "versionId", "technicalCode");
CREATE INDEX "idx_event_map_public_seat_conta_map_version_status" ON "EventMapPublicSeat"("contaId", "eventMapId", "versionId", "status");
CREATE INDEX "idx_event_map_public_seat_conta_event_status" ON "EventMapPublicSeat"("contaId", "eventId", "status");

CREATE INDEX "idx_event_map_reservation_conta_map_version_status" ON "EventMapReservation"("contaId", "eventMapId", "versionId", "status");
CREATE INDEX "idx_event_map_reservation_conta_expires_status" ON "EventMapReservation"("contaId", "expiresAt", "status");

CREATE UNIQUE INDEX "uq_event_map_reservation_seat_reservation_public_seat" ON "EventMapReservationSeat"("reservationId", "publicSeatId");
CREATE INDEX "idx_event_map_reservation_seat_conta_public_seat" ON "EventMapReservationSeat"("contaId", "publicSeatId");

CREATE INDEX "idx_event_map_order_conta_map_version_status" ON "EventMapOrder"("contaId", "eventMapId", "versionId", "status");
CREATE INDEX "idx_event_map_order_conta_event_created" ON "EventMapOrder"("contaId", "eventId", "createdAt");

CREATE UNIQUE INDEX "uq_event_map_order_item_order_public_seat" ON "EventMapOrderItem"("orderId", "publicSeatId");
CREATE INDEX "idx_event_map_order_item_conta_public_seat" ON "EventMapOrderItem"("contaId", "publicSeatId");

CREATE INDEX "idx_event_ticket_conta_event_status" ON "EventTicket"("contaId", "eventId", "status");
CREATE INDEX "idx_event_ticket_conta_order" ON "EventTicket"("contaId", "eventMapOrderId");

ALTER TABLE "EventMapVersion"
  ADD CONSTRAINT "EventMapVersion_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EventMapPublicSeat"
  ADD CONSTRAINT "EventMapPublicSeat_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventMapPublicSeat_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SchoolEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventMapPublicSeat_eventMapId_fkey" FOREIGN KEY ("eventMapId") REFERENCES "EventMap"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventMapPublicSeat_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "EventMapVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventMapReservation"
  ADD CONSTRAINT "EventMapReservation_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventMapReservation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SchoolEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventMapReservation_eventMapId_fkey" FOREIGN KEY ("eventMapId") REFERENCES "EventMap"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventMapReservation_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "EventMapVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventMapReservationSeat"
  ADD CONSTRAINT "EventMapReservationSeat_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventMapReservationSeat_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "EventMapReservation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventMapReservationSeat_publicSeatId_fkey" FOREIGN KEY ("publicSeatId") REFERENCES "EventMapPublicSeat"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventMapOrder"
  ADD CONSTRAINT "EventMapOrder_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventMapOrder_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SchoolEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventMapOrder_eventMapId_fkey" FOREIGN KEY ("eventMapId") REFERENCES "EventMap"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventMapOrder_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "EventMapVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventMapOrder_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "EventMapReservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EventMapOrderItem"
  ADD CONSTRAINT "EventMapOrderItem_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventMapOrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "EventMapOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventMapOrderItem_publicSeatId_fkey" FOREIGN KEY ("publicSeatId") REFERENCES "EventMapPublicSeat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "EventTicket"
  ADD CONSTRAINT "EventTicket_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventTicket_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SchoolEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventTicket_eventMapOrderId_fkey" FOREIGN KEY ("eventMapOrderId") REFERENCES "EventMapOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventTicket_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "EventMapOrderItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
