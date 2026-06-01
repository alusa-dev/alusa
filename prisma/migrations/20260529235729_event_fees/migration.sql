-- AlterTable
ALTER TABLE "EventParticipant" ADD COLUMN     "feePaymentMethod" TEXT,
ADD COLUMN     "isFeePaid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "registrationFeeCharged" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "revenueEntryId" TEXT;

-- AlterTable
ALTER TABLE "SchoolEvent" ADD COLUMN     "registrationFee" DECIMAL(12,2);

-- RenameIndex
ALTER INDEX "uq_event_map_order_item_order_public_seat" RENAME TO "EventMapOrderItem_orderId_publicSeatId_key";

-- RenameIndex
ALTER INDEX "uq_event_map_public_seat_conta_version_code" RENAME TO "EventMapPublicSeat_contaId_versionId_technicalCode_key";

-- RenameIndex
ALTER INDEX "uq_event_map_public_seat_conta_version_original" RENAME TO "EventMapPublicSeat_contaId_versionId_originalSeatId_key";

-- RenameIndex
ALTER INDEX "uq_event_map_reservation_seat_reservation_public_seat" RENAME TO "EventMapReservationSeat_reservationId_publicSeatId_key";
