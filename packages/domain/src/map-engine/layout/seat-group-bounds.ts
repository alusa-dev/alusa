import type { EventSeatDTO, EventSeatGroupDTO } from '../types/event-map-types.js';
import type { BoundsRect } from '../geometry/bounds.js';
import { parentLocalToWorld } from '../geometry/transform-compose.js';

export type SeatGroupTightBounds = BoundsRect & {
  effectiveRows: number;
  effectiveColumns: number;
  seatCount: number;
};

function getConfiguredSeatGroupBounds(group: EventSeatGroupDTO): SeatGroupTightBounds {
  return getSeatGroupBoundsForDimensions(group, group.rows, group.columns, 0);
}

function getSeatGroupBoundsForDimensions(
  group: EventSeatGroupDTO,
  rows: number,
  columns: number,
  seatCount: number,
): SeatGroupTightBounds {
  const stepX = group.seatWidth + group.gapX;
  const stepY = group.seatHeight + group.gapY;
  const effectiveRows = Math.max(1, rows);
  const effectiveColumns = Math.max(1, columns);

  return {
    x: 0,
    y: 0,
    width: group.paddingLeft + effectiveColumns * stepX - group.gapX + group.paddingRight,
    height: group.paddingTop + effectiveRows * stepY - group.gapY + group.paddingBottom,
    effectiveRows,
    effectiveColumns,
    seatCount,
  };
}

export function getSeatGroupTightBounds(
  group: EventSeatGroupDTO,
  seats: EventSeatDTO[],
): SeatGroupTightBounds {
  const groupSeats = seats.filter((seat) => seat.groupId === group.id && seat.publicVisible);
  if (groupSeats.length === 0) return getConfiguredSeatGroupBounds(group);

  const maxRow = Math.max(...groupSeats.map((seat) => seat.rowIndex ?? 0));
  const maxColumn = Math.max(...groupSeats.map((seat) => seat.columnIndex ?? 0));

  return getSeatGroupBoundsForDimensions(group, maxRow + 1, maxColumn + 1, groupSeats.length);
}

export function getSeatGroupWorldBounds(
  group: EventSeatGroupDTO,
  seats: EventSeatDTO[],
): BoundsRect {
  const bounds = getSeatGroupTightBounds(group, seats);
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
    { x: bounds.x, y: bounds.y + bounds.height },
  ].map((corner) => parentLocalToWorld(corner, group));

  const minX = Math.min(...corners.map((corner) => corner.x));
  const minY = Math.min(...corners.map((corner) => corner.y));
  const maxX = Math.max(...corners.map((corner) => corner.x));
  const maxY = Math.max(...corners.map((corner) => corner.y));

  return {
    x: Number(minX.toFixed(4)),
    y: Number(minY.toFixed(4)),
    width: Number((maxX - minX).toFixed(4)),
    height: Number((maxY - minY).toFixed(4)),
  };
}
