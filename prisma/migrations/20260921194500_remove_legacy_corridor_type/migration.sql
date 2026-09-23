-- Existing corridor records become neutral blocked areas before the legacy
-- enum value is removed. This keeps old maps readable without preserving the
-- removed editor behavior.
UPDATE "EventMapObject"
SET "type" = 'BLOCKED_AREA'
WHERE "type" = 'CORRIDOR';

CREATE TYPE "EventMapObjectType_new" AS ENUM (
  'BOARD',
  'SECTION',
  'ROW',
  'SEAT',
  'STAGE',
  'TABLE',
  'TEXT',
  'BLOCKED_AREA',
  'BOOTH',
  'GENERAL_AREA'
);

ALTER TABLE "EventMapObject"
ALTER COLUMN "type" TYPE "EventMapObjectType_new"
USING ("type"::text::"EventMapObjectType_new");

DROP TYPE "EventMapObjectType";
ALTER TYPE "EventMapObjectType_new" RENAME TO "EventMapObjectType";
