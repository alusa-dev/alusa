ALTER TABLE "EventTicket"
ADD COLUMN "legacyCheckInCode" TEXT;

-- Backfill the legacy PDF code exactly once. Codes with at least eight digits
-- use their final eight digits; shorter numeric codes use the existing FNV-1a
-- fallback from packages/lib/src/events/map/ticket-code.ts.
WITH RECURSIVE short_ticket_hashes (id, "ticketCode", position, value) AS (
  SELECT id, "ticketCode", 1, 2166136261::bigint
  FROM "EventTicket"
  WHERE length(regexp_replace("ticketCode", '[^0-9]', '', 'g')) < 8
  UNION ALL
  SELECT id, "ticketCode", position + 1,
    (((value # ascii(substr("ticketCode", position, 1))) * 16777619) % 4294967296)::bigint
  FROM short_ticket_hashes
  WHERE position <= char_length("ticketCode")
)
UPDATE "EventTicket" AS ticket
SET "legacyCheckInCode" = lpad((hash.value % 100000000)::text, 8, '0')
FROM short_ticket_hashes AS hash
WHERE hash.position = char_length(hash."ticketCode") + 1
  AND ticket.id = hash.id;

UPDATE "EventTicket"
SET "legacyCheckInCode" = right(regexp_replace("ticketCode", '[^0-9]', '', 'g'), 8)
WHERE length(regexp_replace("ticketCode", '[^0-9]', '', 'g')) >= 8;

-- Duplicates are intentional: readers fetch at most two rows to detect
-- ambiguous short codes and reject them without exposing a wrong ticket.
CREATE INDEX "idx_event_ticket_conta_legacy_check_in_code"
ON "EventTicket"("contaId", "legacyCheckInCode");
