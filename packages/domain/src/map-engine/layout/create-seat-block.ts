import type { EventMapDocument, MapSeatBlock, SeatDistributionAlignment, SeatDistributionMode, SeatDistributionSegment } from '../model/event-map-document.js';

export type CreateSeatBlockInput = {
  document: EventMapDocument;
  sectionId: string;
  origin: { x: number; y: number };
  rows: number;
  columns: number;
  seatSize: number;
  seatGap: number;
  rowGap: number;
  rowPrefix?: string;
  startNumber?: number;
  rowSeatCounts?: number[];
  distribution?: SeatDistributionSegment[];
  distributionMode?: SeatDistributionMode;
  distributionAlignment?: SeatDistributionAlignment;
  firstRowSeatCount?: number;
  lastRowSeatCount?: number;
  fitMinimumSeatCount?: number;
  fitMaximumSeatCount?: number;
  createId: (prefix: string) => string;
};

function rowLabel(prefix: string, index: number) {
  const normalized = prefix.trim().toUpperCase() || 'A';
  if (!/^[A-Z]+$/.test(normalized)) return `${normalized}${index + 1}`;
  let base = 0;
  for (const char of normalized) base = base * 26 + char.charCodeAt(0) - 64;
  let value = Math.max(1, base + index);
  let label = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

export function createSeatBlock(input: CreateSeatBlockInput) {
  const rowsCount = Math.max(1, Math.round(input.rows));
  const columns = Math.max(1, Math.round(input.columns));
  const seatSize = Math.max(1, input.seatSize);
  const seatGap = Math.max(0, input.seatGap);
  const rowGap = Math.max(0, input.rowGap);
  const blockId = input.createId('block');
  const rowIds: string[] = [];
  const rows: MapSeatBlock['rows'] = [];
  const prefix = input.rowPrefix ?? 'A';
  const startNumber = Math.max(1, Math.round(input.startNumber ?? 1));
  const rowSeatCounts = input.rowSeatCounts?.map((count) => Math.max(0, Math.round(count)));
  const pitch = seatSize + seatGap;
  for (let rowIndex = 0; rowIndex < rowsCount; rowIndex += 1) {
    const rowId = input.createId('row');
    rowIds.push(rowId);
    const label = rowLabel(prefix, rowIndex);
    const rowSeatCount = rowSeatCounts?.[rowIndex] ?? columns;
    const seats = Array.from({ length: rowSeatCount }, (_, columnIndex) => {
      const number = startNumber + columnIndex;
      return {
        id: input.createId('seat'),
        label: `${label}${number}`,
        technicalCode: `${label}${number}`,
        rowIndex,
        columnIndex,
        accessible: false,
        publicVisible: true,
      };
    });
    rows.push({
      id: rowId,
      sectionId: input.sectionId,
      blockId,
      label,
      path: {
        type: 'LINE',
        start: { x: input.origin.x - seatSize / 2, y: input.origin.y + rowIndex * (seatSize + rowGap) },
        end: { x: input.origin.x + (rowSeatCount - 1) * pitch + seatSize / 2, y: input.origin.y + rowIndex * (seatSize + rowGap) },
      },
      seatGap,
      seatSize,
      seatIds: seats.map((seat) => seat.id),
      seats,
      ...(rowSeatCounts ? { distribution: [{ type: 'SEATS' as const, count: rowSeatCount }] } : {}),
    });
  }

  const block: MapSeatBlock = {
    id: blockId,
    sectionId: input.sectionId,
    name: null,
    columnCount: columns,
    rowGap,
    defaultSeatGap: seatGap,
    distribution: input.distribution ?? [{ type: 'SEATS', count: Math.max(0, ...(rowSeatCounts ?? [columns])) }],
    distributionMode: rowSeatCounts ? 'FIXED' : input.distributionMode ?? 'FIXED',
    distributionAlignment: input.distributionAlignment ?? 'LEFT',
    firstRowSeatCount: input.firstRowSeatCount ?? columns,
    lastRowSeatCount: input.lastRowSeatCount ?? columns,
    fitMinimumSeatCount: input.fitMinimumSeatCount ?? 1,
    fitMaximumSeatCount: input.fitMaximumSeatCount ?? columns,
    rowIds,
    rows,
  };

  const document: EventMapDocument = {
    ...input.document,
    sections: input.document.sections.map((section) => {
      if (section.id !== input.sectionId) return section;
      return {
        ...section,
        blockIds: [...section.blockIds, blockId],
        blocks: [...section.blocks, block],
      };
    }),
  };

  return { document, blockId };
}
