import { PrismaClient } from '@prisma/client';
import { migrateLegacyMapDocument } from '@alusa/domain';

/** One-shot compatibility reader executed before EventSeatGroup is removed. */
type LegacyMap = { id: string; createdAt: Date };
type LegacySection = {
  id: string; levelId: string; lotId: string | null; name: string; color: string;
  capacity: number | null; status: string; notes: string | null;
};
type LegacyGroup = {
  id: string; levelId: string; name: string | null; x: unknown; y: unknown; rotation: unknown;
  rows: number; columns: number; seatWidth: unknown; gapX: unknown; gapY: unknown;
};
type LegacySeat = {
  id: string; sectionId: string; groupId: string | null; rowIndex: number | null; columnIndex: number | null;
  technicalCode: string; displayLabel: string; rowLabel: string | null; seatNumber: string | null;
  accessible: boolean; publicVisible: boolean;
};
type LegacyObject = {
  id: string; levelId: string; sectionId: string | null; type: string; data: unknown; x: unknown; y: unknown;
  width: unknown; height: unknown; rotation: unknown; locked: boolean; hidden: boolean; sortOrder: number;
};

const prisma = new PrismaClient();
const apply = process.argv.includes('--apply');
const numberValue = (value: unknown) => Number(value ?? 0);

async function main() {
  const maps = await prisma.$queryRawUnsafe<LegacyMap[]>(
    'SELECT "id", "createdAt" FROM "EventMap" WHERE "draftDocument" IS NULL ORDER BY "createdAt" ASC',
  );

  let migrated = 0;
  for (const map of maps) {
    const [sections, groups, seats, objects] = await Promise.all([
      prisma.$queryRawUnsafe<LegacySection[]>(
        'SELECT "id", "levelId", "lotId", "name", "color", "capacity", "status", "notes" FROM "EventMapSection" WHERE "eventMapId" = $1 ORDER BY "createdAt" ASC', map.id,
      ),
      prisma.$queryRawUnsafe<LegacyGroup[]>(
        'SELECT "id", "levelId", "name", "x", "y", "rotation", "rows", "columns", "seatWidth", "gapX", "gapY" FROM "EventSeatGroup" WHERE "eventMapId" = $1 ORDER BY "createdAt" ASC', map.id,
      ),
      prisma.$queryRawUnsafe<LegacySeat[]>(
        'SELECT "id", "sectionId", "groupId", "rowIndex", "columnIndex", "technicalCode", "displayLabel", "rowLabel", "seatNumber", "accessible", "publicVisible" FROM "EventSeat" WHERE "eventMapId" = $1 ORDER BY "technicalCode" ASC', map.id,
      ),
      prisma.$queryRawUnsafe<LegacyObject[]>(
        'SELECT "id", "levelId", "sectionId", "type", "data", "x", "y", "width", "height", "rotation", "locked", "hidden", "sortOrder" FROM "EventMapObject" WHERE "eventMapId" = $1 ORDER BY "sortOrder" ASC, "createdAt" ASC', map.id,
      ),
    ]);

    const document = migrateLegacyMapDocument({
      sections,
      groups: groups.map((group) => ({
        ...group,
        x: numberValue(group.x), y: numberValue(group.y), rotation: numberValue(group.rotation),
        seatWidth: numberValue(group.seatWidth), gapX: numberValue(group.gapX), gapY: numberValue(group.gapY),
      })),
      seats,
      visualElements: objects.map((object) => ({
        ...object,
        data: (object.data ?? {}) as Record<string, unknown>,
        x: numberValue(object.x), y: numberValue(object.y),
        width: object.width == null ? null : numberValue(object.width),
        height: object.height == null ? null : numberValue(object.height),
        rotation: numberValue(object.rotation),
      })),
    });

    if (apply) await prisma.eventMap.update({ where: { id: map.id }, data: { draftDocument: document } });
    migrated += 1;
    console.log(`${apply ? 'Migrado' : 'Prévia'} ${map.id} · ${document.sections.length} seções`);
  }

  console.log(`${apply ? 'Migração' : 'Prévia'} concluída: ${migrated} mapas.`);
  if (!apply && migrated > 0) console.log('Execute novamente com --apply para persistir os documentos.');
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
