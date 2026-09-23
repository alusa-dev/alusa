import type { EventMapDocument, MapSeatBlock, SeatDistributionSegment, SeatRowPath } from '../model/event-map-document.js';

export function updateSeatRowPath(document: EventMapDocument, rowId: string, path: SeatRowPath): EventMapDocument {
  return {
    ...document,
    sections: document.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map((block) => ({
        ...block,
        rows: block.rows.map((row) => (row.id === rowId ? { ...row, path } : row)),
      })),
    })),
  };
}

export function updateSeatBlock(
  document: EventMapDocument,
  blockId: string,
  patch: Partial<Pick<MapSeatBlock, 'name' | 'columnCount' | 'rowGap' | 'defaultSeatGap' | 'distribution' | 'distributionMode' | 'distributionAlignment' | 'firstRowSeatCount' | 'lastRowSeatCount' | 'fitMinimumSeatCount' | 'fitMaximumSeatCount'>> & { distribution?: SeatDistributionSegment[] },
): EventMapDocument {
  return {
    ...document,
    sections: document.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map((block) => (block.id === blockId ? { ...block, ...patch } : block)),
    })),
  };
}

export function updateSeatRow(
  document: EventMapDocument,
  rowId: string,
  patch: Partial<Pick<NonNullable<EventMapDocument['sections'][number]['blocks'][number]['rows'][number]>, 'label' | 'seatGap' | 'seatSize'>>,
): EventMapDocument {
  return {
    ...document,
    sections: document.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map((block) => ({
        ...block,
        rows: block.rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
      })),
    })),
  };
}
