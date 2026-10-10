import type { MapSeatBlock } from '../model/event-map-document.js';
import { resolveSeatCountForRow } from './resolve-map-layout.js';

/** Returns the next number after the largest purely numeric seat label in the supplied blocks. */
export function getNextNumericSeatNumber(blocks: readonly MapSeatBlock[]) {
  let maximum = 0;
  for (const block of blocks) {
    for (const row of block.rows) {
      for (const seat of row.seats) {
        const candidate = seat.label.trim();
        if (/^\d+$/.test(candidate)) maximum = Math.max(maximum, Number(candidate));
      }
    }
  }
  return maximum + 1;
}

/** Rebuilds generated seat labels and map-unique codes after a block layout change. */
export function applySeatBlockNumbering(block: MapSeatBlock): MapSeatBlock {
  let nextNumericNumber = Math.max(0, Math.round(block.startNumber ?? 1) - 1);
  return {
    ...block,
    rows: block.rows.map((row, rowIndex, rows) => {
      const activeSeatCount = resolveSeatCountForRow(block, row, rowIndex, rows.length);
      const nextRow = {
        ...row,
        seats: row.seats.map((seat, seatIndex) => {
          if (seatIndex >= activeSeatCount) return seat;
          const visualColumnIndex = block.numberingDirection === 'right-to-left'
            ? activeSeatCount - seatIndex - 1
            : seatIndex;
          const seatNumber = block.numberingMode === 'NUMERIC'
            ? String(nextNumericNumber + visualColumnIndex + 1)
            : String(Math.max(1, Math.round(block.startNumber ?? 1)) + visualColumnIndex);
          const label = block.numberingMode === 'NUMERIC' ? seatNumber : `${row.label}${seatNumber}`;
          return {
            ...seat,
            label,
            technicalCode: `${block.id}-${seat.id}`,
            rowLabel: row.label,
            seatNumber,
          };
        }),
      };
      if (block.numberingMode === 'NUMERIC') nextNumericNumber += activeSeatCount;
      return nextRow;
    }),
  };
}
