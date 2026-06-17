-- CreateEnum
CREATE TYPE "EventMapReservationSource" AS ENUM ('PUBLIC_CHECKOUT', 'STAFF_MANUAL');

-- AlterTable
ALTER TABLE "EventMapReservation" ADD COLUMN "source" "EventMapReservationSource" NOT NULL DEFAULT 'PUBLIC_CHECKOUT';
ALTER TABLE "EventMapReservation" ADD COLUMN "createdByUserId" TEXT;

-- AlterTable
ALTER TABLE "EventTicket" ALTER COLUMN "eventMapOrderId" DROP NOT NULL;
ALTER TABLE "EventTicket" ALTER COLUMN "orderItemId" DROP NOT NULL;
ALTER TABLE "EventTicket" ADD COLUMN "eventTicketSaleId" TEXT;
ALTER TABLE "EventTicket" ADD COLUMN "saleSeatId" TEXT;

-- CreateTable
CREATE TABLE "EventTicketSaleSeat" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "publicSeatId" TEXT NOT NULL,
    "unitPriceSnapshot" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "sectionName" TEXT NOT NULL,
    "seatLabel" TEXT NOT NULL,
    "technicalCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventTicketSaleSeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_event_map_reservation_conta_source_status" ON "EventMapReservation"("contaId", "source", "status");
CREATE INDEX "idx_event_ticket_conta_sale" ON "EventTicket"("contaId", "eventTicketSaleId");
CREATE UNIQUE INDEX "EventTicket_saleSeatId_key" ON "EventTicket"("saleSeatId");
CREATE UNIQUE INDEX "uq_event_ticket_sale_seat_sale_public_seat" ON "EventTicketSaleSeat"("saleId", "publicSeatId");
CREATE INDEX "idx_event_ticket_sale_seat_conta_public_seat" ON "EventTicketSaleSeat"("contaId", "publicSeatId");
CREATE INDEX "idx_event_ticket_sale_seat_conta_sale" ON "EventTicketSaleSeat"("contaId", "saleId");

-- AddForeignKey
ALTER TABLE "EventMapReservation" ADD CONSTRAINT "EventMapReservation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EventTicket" ADD CONSTRAINT "EventTicket_eventTicketSaleId_fkey" FOREIGN KEY ("eventTicketSaleId") REFERENCES "EventTicketSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventTicket" ADD CONSTRAINT "EventTicket_saleSeatId_fkey" FOREIGN KEY ("saleSeatId") REFERENCES "EventTicketSaleSeat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventTicketSaleSeat" ADD CONSTRAINT "EventTicketSaleSeat_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventTicketSaleSeat" ADD CONSTRAINT "EventTicketSaleSeat_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "EventTicketSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventTicketSaleSeat" ADD CONSTRAINT "EventTicketSaleSeat_publicSeatId_fkey" FOREIGN KEY ("publicSeatId") REFERENCES "EventMapPublicSeat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
