import type { EventMapDocument, MapSeatBlock, SeatDistributionSegment, SeatRowPath } from '../model/event-map-document.js';
import { applySeatBlockNumbering } from '../layout/seat-block-numbering.js';

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

/**
 * Canonical block update. Numbering-mode changes rebuild labels immediately;
 * numeric blocks rebuild them on every update so row/seat count changes keep
 * their sequential numbering. Geometry builders that replace rows directly
 * should apply `applySeatBlockNumbering` after the final rows are assembled.
 */
export function updateSeatBlock(
  document: EventMapDocument,
  blockId: string,
  patch: Partial<Pick<MapSeatBlock, 'name' | 'columnCount' | 'rowGap' | 'defaultSeatGap' | 'distribution' | 'distributionMode' | 'distributionAlignment' | 'firstRowSeatCount' | 'lastRowSeatCount' | 'fitMinimumSeatCount' | 'fitMaximumSeatCount' | 'numberingMode'>> & { distribution?: SeatDistributionSegment[] },
): EventMapDocument {
  return {
    ...document,
    sections: document.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map((block) => {
        if (block.id !== blockId) return block;
        const updatedBlock = { ...block, ...patch };
        return patch.numberingMode !== undefined || updatedBlock.numberingMode === 'NUMERIC'
          ? applySeatBlockNumbering(updatedBlock)
          : updatedBlock;
      }),
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
