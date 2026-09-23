import type { EventMapDocument, MapSeat, MapSeatBlock, MapSeatRow } from '../model/event-map-document.js';

type LegacySeat = {
  id: string;
  sectionId: string;
  groupId?: string | null;
  rowIndex: number | null;
  columnIndex: number | null;
  technicalCode: string;
  displayLabel: string;
  rowLabel: string | null;
  seatNumber: string | null;
  accessible: boolean;
  publicVisible: boolean;
  x?: number;
  y?: number;
};

type LegacyGroup = {
  id: string;
  sectionId?: string | null;
  levelId: string;
  name?: string | null;
  x: number;
  y: number;
  rotation: number;
  rows: number;
  columns: number;
  seatWidth: number;
  gapX: number;
  gapY: number;
};

type LegacySection = {
  id: string;
  levelId: string;
  name: string;
  color: string;
  lotId?: string | null;
  capacity?: number | null;
  status?: string;
  notes?: string | null;
};

export function migrateLegacyMapDocument(input: {
  sections: LegacySection[];
  groups: LegacyGroup[];
  seats: LegacySeat[];
  visualElements?: EventMapDocument['visualElements'];
}): EventMapDocument {
  const inferredSectionByGroup = new Map<string, string>();
  for (const seat of input.seats) {
    if (seat.groupId && !inferredSectionByGroup.has(seat.groupId)) inferredSectionByGroup.set(seat.groupId, seat.sectionId);
  }
  const assignedGroupIds = new Set<string>();
  const sections = input.sections.map((section) => {
    const sectionGroups = input.groups.filter((group) => {
      if (assignedGroupIds.has(group.id)) return false;
      const ownerSectionId = group.sectionId ?? inferredSectionByGroup.get(group.id);
      return ownerSectionId === section.id;
    });
    sectionGroups.forEach((group) => assignedGroupIds.add(group.id));
    const blocks: MapSeatBlock[] = sectionGroups.map((group) => {
      const groupSeats = input.seats.filter(
        (seat) => seat.sectionId === section.id && (seat.groupId === group.id || (!seat.groupId && sectionGroups.length === 1)),
      );
      const rows = Array.from({ length: Math.max(1, group.rows) }, (_, rowIndex): MapSeatRow => {
        const seats = groupSeats
          .filter((seat) => (seat.rowIndex ?? 0) === rowIndex)
          .sort((left, right) => (left.columnIndex ?? 0) - (right.columnIndex ?? 0))
          .map((seat, columnIndex): MapSeat => ({
            id: seat.id,
            label: seat.displayLabel,
            technicalCode: seat.technicalCode,
            rowIndex,
            columnIndex: seat.columnIndex ?? columnIndex,
            accessible: seat.accessible,
            publicVisible: seat.publicVisible,
          }));
        const first = groupSeats.find((seat) => (seat.rowIndex ?? 0) === rowIndex);
        const last = groupSeats.filter((seat) => (seat.rowIndex ?? 0) === rowIndex).at(-1);
        const startX = first?.x ?? group.x;
        const startY = first?.y ?? group.y + rowIndex * (group.seatWidth + group.gapY);
        const endX = last?.x ?? startX + Math.max(group.seatWidth, (group.columns - 1) * (group.seatWidth + group.gapX));
        const endY = last?.y ?? startY;
        return {
          id: `${group.id}-row-${rowIndex + 1}`,
          sectionId: section.id,
          blockId: group.id,
          label: first?.rowLabel ?? String.fromCharCode(65 + rowIndex),
          path: { type: 'LINE', start: { x: startX, y: startY }, end: { x: endX, y: endY } },
          seatGap: group.gapX,
          seatSize: group.seatWidth,
          seatIds: seats.map((seat) => seat.id),
          seats,
          distribution: [{ type: 'SEATS', count: seats.length }],
        };
      });
      return {
        id: group.id,
        sectionId: section.id,
        name: group.name,
        columnCount: group.columns,
        rowGap: group.gapY,
        defaultSeatGap: group.gapX,
        distribution: [{ type: 'SEATS', count: group.columns }],
        rowIds: rows.map((row) => row.id),
        rows,
      };
    });
    const ungroupedSeats = input.seats.filter((seat) => seat.sectionId === section.id && !seat.groupId && sectionGroups.length === 0);
    if (ungroupedSeats.length > 0) {
      const rowIndexes = [...new Set(ungroupedSeats.map((seat) => seat.rowIndex ?? 0))].sort((a, b) => a - b);
      const implicitRows = rowIndexes.map((rowIndex, index) => {
        const rowSeats = ungroupedSeats.filter((seat) => (seat.rowIndex ?? 0) === rowIndex).sort((a, b) => (a.columnIndex ?? 0) - (b.columnIndex ?? 0));
        const first = rowSeats[0];
        const last = rowSeats.at(-1) ?? first;
        return {
          id: `legacy-row-${section.id}-${index + 1}`,
          sectionId: section.id,
          blockId: `legacy-block-${section.id}`,
          label: first?.rowLabel ?? String.fromCharCode(65 + index),
          path: { type: 'LINE' as const, start: { x: first?.x ?? 0, y: first?.y ?? index * 42 }, end: { x: last?.x ?? first?.x ?? 240, y: last?.y ?? first?.y ?? index * 42 } },
          seatGap: 4,
          seatSize: Math.max(1, rowSeats[0] ? 24 : 24),
          seatIds: rowSeats.map((seat) => seat.id),
          seats: rowSeats.map((seat, columnIndex) => ({ id: seat.id, label: seat.displayLabel, technicalCode: seat.technicalCode, rowIndex, columnIndex: seat.columnIndex ?? columnIndex, accessible: seat.accessible, publicVisible: seat.publicVisible })),
          distribution: [{ type: 'SEATS', count: rowSeats.length }],
        } satisfies MapSeatRow;
      });
      if (implicitRows.length > 0) {
        blocks.push({ id: `legacy-block-${section.id}`, sectionId: section.id, name: 'Assentos migrados', rowGap: 4, defaultSeatGap: 4, distribution: [{ type: 'SEATS', count: Math.max(...implicitRows.map((row) => row.seats.length)) }], rowIds: implicitRows.map((row) => row.id), rows: implicitRows });
      }
    }
    const sectionSeats = input.seats.filter((seat) => seat.sectionId === section.id);
    const minX = Math.min(...sectionSeats.map((seat) => seat.x ?? 0), 0) - 24;
    const maxX = Math.max(...sectionSeats.map((seat) => seat.x ?? 1200), 1200);
    const minY = Math.min(...sectionSeats.map((seat) => seat.y ?? 0), 0) - 24;
    const maxY = Math.max(...sectionSeats.map((seat) => seat.y ?? 900), 900);
    return {
      ...section,
      position: { x: 0, y: 0 },
      rotation: 0,
      outline: [{ x: minX, y: minY }, { x: maxX, y: minY }, { x: maxX, y: maxY }, { x: minX, y: maxY }],
      blockIds: blocks.map((block) => block.id),
      blocks,
    };
  });
  return { schemaVersion: 1, sections, visualElements: input.visualElements ?? [] };
}
