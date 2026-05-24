import type { Point, Size } from '../geometry/types.js';
import type { DerivedSeat, Seat, SeatGroup } from './types.js';
import type { CorridorImpact } from '../corridors/types.js';
import { getSeatLabel } from './label-seats.js';

/** Retorna a posição local do assento dentro do SeatGroup (origin no canto superior-esquerdo do grupo). */
export function getSeatLocalPosition(input: {
  rowIndex: number;
  columnIndex: number;
  group: SeatGroup;
}): Point {
  const { rowIndex, columnIndex, group } = input;
  return {
    x: group.paddingLeft + columnIndex * (group.seatWidth + group.gapX),
    y: group.paddingTop + rowIndex * (group.seatHeight + group.gapY),
  };
}

/** Tamanho visual total do SeatGroup (inclui padding). */
export function getSeatGroupLocalSize(group: SeatGroup): Size {
  const innerWidth =
    group.columns * group.seatWidth + (group.columns - 1) * group.gapX;
  const innerHeight =
    group.rows * group.seatHeight + (group.rows - 1) * group.gapY;
  return {
    width: group.paddingLeft + innerWidth + group.paddingRight,
    height: group.paddingTop + innerHeight + group.paddingBottom,
  };
}

/**
 * Deriva a lista completa de DerivedSeat para um grupo.
 * Posição visual = posição base (do grupo) + offset de corredor + override manual.
 * NUNCA persiste visualX/visualY como base.
 */
export function deriveSeats(
  group: SeatGroup,
  seats: Seat[],
  corridorImpacts?: CorridorImpact[],
): DerivedSeat[] {
  // índice de offsets por seatId
  const offsetBySeatId = new Map<string, { dx: number; dy: number }>();
  if (corridorImpacts) {
    for (const impact of corridorImpacts) {
      for (const [seatId, offset] of impact.offsetsBySeatId) {
        const existing = offsetBySeatId.get(seatId);
        offsetBySeatId.set(seatId, {
          dx: (existing?.dx ?? 0) + offset.dx,
          dy: (existing?.dy ?? 0) + offset.dy,
        });
      }
    }
  }

  return seats.map((seat): DerivedSeat => {
    const localPos = getSeatLocalPosition({
      rowIndex: seat.rowIndex,
      columnIndex: seat.columnIndex,
      group,
    });

    const corridorOffset = offsetBySeatId.get(seat.id) ?? { dx: 0, dy: 0 };

    const manualDx = seat.manualOverride?.dx ?? 0;
    const manualDy = seat.manualOverride?.dy ?? 0;

    const width = seat.manualOverride?.width ?? group.seatWidth;
    const height = seat.manualOverride?.height ?? group.seatHeight;

    const hidden =
      seat.manualOverride?.hidden === true ||
      seat.status === 'HIDDEN_BY_CORRIDOR' ||
      seat.status === 'REMOVED';

    return {
      ...seat,
      visualX: group.x + localPos.x + corridorOffset.dx + manualDx,
      visualY: group.y + localPos.y + corridorOffset.dy + manualDy,
      width,
      height,
      rotation: group.rotation,
      hidden,
      corridorOffset,
    };
  });
}

/** Gera a label de todos os assentos de um grupo usando a config de numeração. */
export function relabelGroup(group: SeatGroup, seats: Seat[]): Seat[] {
  return seats.map((seat) => ({
    ...seat,
    label: getSeatLabel({
      rowIndex: seat.rowIndex,
      columnIndex: seat.columnIndex,
      numbering: group.numbering,
      totalRows: group.rows,
      totalColumns: group.columns,
    }),
  }));
}
