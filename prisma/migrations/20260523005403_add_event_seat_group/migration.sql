-- AlterTable
ALTER TABLE "EventSeat" ADD COLUMN     "columnIndex" INTEGER,
ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "rowIndex" INTEGER;

-- CreateTable
CREATE TABLE "EventSeatGroup" (
    "id" TEXT NOT NULL,
    "contaId" TEXT NOT NULL,
    "eventMapId" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "name" TEXT,
    "x" DECIMAL(12,2) NOT NULL,
    "y" DECIMAL(12,2) NOT NULL,
    "rotation" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "rows" INTEGER NOT NULL,
    "columns" INTEGER NOT NULL,
    "seatWidth" DECIMAL(8,2) NOT NULL DEFAULT 28,
    "seatHeight" DECIMAL(8,2) NOT NULL DEFAULT 28,
    "gapX" DECIMAL(8,2) NOT NULL DEFAULT 4,
    "gapY" DECIMAL(8,2) NOT NULL DEFAULT 4,
    "paddingTop" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "paddingRight" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "paddingBottom" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "paddingLeft" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "numbering" JSONB NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventSeatGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_event_seat_group_conta_map_level" ON "EventSeatGroup"("contaId", "eventMapId", "levelId");

-- AddForeignKey
ALTER TABLE "EventSeatGroup" ADD CONSTRAINT "EventSeatGroup_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSeatGroup" ADD CONSTRAINT "EventSeatGroup_eventMapId_fkey" FOREIGN KEY ("eventMapId") REFERENCES "EventMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSeatGroup" ADD CONSTRAINT "EventSeatGroup_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "EventMapLevel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventSeat" ADD CONSTRAINT "EventSeat_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "EventSeatGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "uq_event_map_version_map_version" RENAME TO "EventMapVersion_eventMapId_version_key";

-- RenameIndex
ALTER INDEX "uq_event_seat_conta_map_code" RENAME TO "EventSeat_contaId_eventMapId_technicalCode_key";

-- RenameIndex
ALTER INDEX "uq_finance_summary_conta_window" RENAME TO "FinanceSummaryReadModel_contaId_windowStart_windowEnd_key";

-- RenameIndex
ALTER INDEX "uq_finance_side_effect_dedupe" RENAME TO "FinanceWebhookSideEffectOutbox_contaId_dedupeKey_key";
