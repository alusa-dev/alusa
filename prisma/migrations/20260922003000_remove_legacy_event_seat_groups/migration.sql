-- The canonical event map document is the source of truth for sections, blocks,
-- rows and seats. Run `pnpm events:map:migrate-document --apply` before this
-- migration so every existing map has a draftDocument snapshot.

ALTER TABLE "EventSeat" DROP CONSTRAINT IF EXISTS "EventSeat_groupId_fkey";
DROP INDEX IF EXISTS "idx_event_seat_group_conta_map_level";
ALTER TABLE "EventSeat" DROP COLUMN IF EXISTS "groupId";
DROP TABLE IF EXISTS "EventSeatGroup";
