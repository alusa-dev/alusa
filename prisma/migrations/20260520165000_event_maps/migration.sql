-- Event map editor, numbered seats, and publishable map snapshots.

CREATE TYPE "EventTicketMode" AS ENUM ('NONE', 'SIMPLE', 'NUMBERED_SEATS');
CREATE TYPE "EventMapStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "EventMapObjectType" AS ENUM (
  'BOARD',
  'SECTION',
  'ROW',
  'SEAT',
  'STAGE',
  'TABLE',
  'TEXT',
  'BLOCKED_AREA',
  'CORRIDOR',
  'BOOTH',
  'GENERAL_AREA'
);
CREATE TYPE "EventSeatStatus" AS ENUM (
  'AVAILABLE',
  'HELD',
  'SOLD',
  'BLOCKED',
  'COMPLIMENTARY',
  'UNAVAILABLE'
);

ALTER TABLE "SchoolEvent"
  ADD COLUMN "ticketMode" "EventTicketMode" NOT NULL DEFAULT 'NONE';

UPDATE "SchoolEvent"
SET "ticketMode" = 'SIMPLE'
WHERE "hasTickets" = true AND "ticketMode" = 'NONE';

CREATE TABLE "EventMap" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "EventMapStatus" NOT NULL DEFAULT 'DRAFT',
  "publishedVersionId" TEXT,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "archivedAt" TIMESTAMP(3),

  CONSTRAINT "EventMap_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventMapVersion" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "eventMapId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "EventMapStatus" NOT NULL,
  "snapshot" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "EventMapVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventMapLevel" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "eventMapId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "widthPx" INTEGER NOT NULL DEFAULT 1600,
  "heightPx" INTEGER NOT NULL DEFAULT 1000,
  "unit" TEXT NOT NULL DEFAULT 'px',
  "scale" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EventMapLevel_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventMapObject" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "eventMapId" TEXT NOT NULL,
  "levelId" TEXT NOT NULL,
  "sectionId" TEXT,
  "type" "EventMapObjectType" NOT NULL,
  "data" JSONB NOT NULL,
  "x" DECIMAL(12,2) NOT NULL,
  "y" DECIMAL(12,2) NOT NULL,
  "width" DECIMAL(12,2),
  "height" DECIMAL(12,2),
  "rotation" DECIMAL(8,2) NOT NULL DEFAULT 0,
  "locked" BOOLEAN NOT NULL DEFAULT false,
  "hidden" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EventMapObject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventMapSection" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "eventMapId" TEXT NOT NULL,
  "levelId" TEXT NOT NULL,
  "lotId" TEXT,
  "name" TEXT NOT NULL,
  "color" TEXT NOT NULL,
  "capacity" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EventMapSection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EventSeat" (
  "id" TEXT NOT NULL,
  "contaId" TEXT NOT NULL,
  "eventMapId" TEXT NOT NULL,
  "levelId" TEXT NOT NULL,
  "sectionId" TEXT NOT NULL,
  "objectId" TEXT,
  "technicalCode" TEXT NOT NULL,
  "displayLabel" TEXT NOT NULL,
  "rowLabel" TEXT,
  "seatNumber" TEXT,
  "status" "EventSeatStatus" NOT NULL DEFAULT 'AVAILABLE',
  "accessible" BOOLEAN NOT NULL DEFAULT false,
  "publicVisible" BOOLEAN NOT NULL DEFAULT true,
  "x" DECIMAL(12,2) NOT NULL,
  "y" DECIMAL(12,2) NOT NULL,
  "size" DECIMAL(8,2),
  "rotation" DECIMAL(8,2) NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "EventSeat_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_event_map_conta" ON "EventMap"("contaId");
CREATE INDEX "idx_event_map_conta_event_status" ON "EventMap"("contaId", "eventId", "status");
CREATE INDEX "idx_event_map_conta_updated" ON "EventMap"("contaId", "updatedAt");

CREATE UNIQUE INDEX "uq_event_map_version_map_version" ON "EventMapVersion"("eventMapId", "version");
CREATE INDEX "idx_event_map_version_conta_map" ON "EventMapVersion"("contaId", "eventMapId");

CREATE INDEX "idx_event_map_level_conta_map" ON "EventMapLevel"("contaId", "eventMapId");

CREATE INDEX "idx_event_map_object_conta_map_level" ON "EventMapObject"("contaId", "eventMapId", "levelId");
CREATE INDEX "idx_event_map_object_conta_section" ON "EventMapObject"("contaId", "sectionId");

CREATE INDEX "idx_event_map_section_conta_map" ON "EventMapSection"("contaId", "eventMapId");
CREATE INDEX "idx_event_map_section_conta_lot" ON "EventMapSection"("contaId", "lotId");

CREATE UNIQUE INDEX "uq_event_seat_conta_map_code" ON "EventSeat"("contaId", "eventMapId", "technicalCode");
CREATE INDEX "idx_event_seat_conta_map_status" ON "EventSeat"("contaId", "eventMapId", "status");
CREATE INDEX "idx_event_seat_conta_section" ON "EventSeat"("contaId", "sectionId");

ALTER TABLE "EventMap"
  ADD CONSTRAINT "EventMap_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventMap_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "SchoolEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventMapVersion"
  ADD CONSTRAINT "EventMapVersion_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventMapVersion_eventMapId_fkey" FOREIGN KEY ("eventMapId") REFERENCES "EventMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventMapLevel"
  ADD CONSTRAINT "EventMapLevel_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventMapLevel_eventMapId_fkey" FOREIGN KEY ("eventMapId") REFERENCES "EventMap"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventMapObject"
  ADD CONSTRAINT "EventMapObject_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventMapObject_eventMapId_fkey" FOREIGN KEY ("eventMapId") REFERENCES "EventMap"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventMapObject_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "EventMapLevel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EventMapSection"
  ADD CONSTRAINT "EventMapSection_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventMapSection_eventMapId_fkey" FOREIGN KEY ("eventMapId") REFERENCES "EventMap"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventMapSection_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "EventMapLevel"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventMapSection_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "EventTicketLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EventSeat"
  ADD CONSTRAINT "EventSeat_contaId_fkey" FOREIGN KEY ("contaId") REFERENCES "Conta"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventSeat_eventMapId_fkey" FOREIGN KEY ("eventMapId") REFERENCES "EventMap"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventSeat_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "EventMapLevel"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "EventSeat_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "EventMapSection"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
