import type { EventSeatDTO, EventSeatGroupDTO } from '../types/event-map-types.js';
import type { BoundsRect } from '../geometry/bounds.js';
import { parentLocalToWorld, worldToParentLocal } from '../geometry/transform-compose.js';

export type SeatGroupTightBounds = BoundsRect & {
  effectiveRows: number;
  effectiveColumns: number;
  seatCount: number;
};

function getSeatLocalCenter(group: EventSeatGroupDTO, seat: EventSeatDTO) {
  return worldToParentLocal({ x: seat.x, y: seat.y }, group);
}

function getConfiguredSeatGroupBounds(group: EventSeatGroupDTO): SeatGroupTightBounds {
  const stepX = group.seatWidth + group.gapX;
  const stepY = group.seatHeight + group.gapY;
  return {
    x: 0,
    y: 0,
    width: group.paddingLeft + group.columns * stepX - group.gapX + group.paddingRight,
    height: group.paddingTop + group.rows * stepY - group.gapY + group.paddingBottom,
    effectiveRows: group.rows,
    effectiveColumns: group.columns,
    seatCount: 0,
  };
}

export function getSeatGroupTightBounds(
  group: EventSeatGroupDTO,
  seats: EventSeatDTO[],
): SeatGroupTightBounds {
  const groupSeats = seats.filter((seat) => seat.groupId === group.id && seat.publicVisible);
  if (groupSeats.length === 0) {
    return getConfiguredSeatGroupBounds(group);
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxRow = -1;
  let maxColumn = -1;

  for (const seat of groupSeats) {
    const center = getSeatLocalCenter(group, seat);
    const size = seat.size ?? group.seatWidth;
    const radius = size / 2;
    minX = Math.min(minX, center.x - radius);
    minY = Math.min(minY, center.y - radius);
    maxX = Math.max(maxX, center.x + radius);
    maxY = Math.max(maxY, center.y + radius);

    if (typeof seat.rowIndex === 'number') maxRow = Math.max(maxRow, seat.rowIndex);
    if (typeof seat.columnIndex === 'number') maxColumn = Math.max(maxColumn, seat.columnIndex);
  }

  const x = minX - group.paddingLeft;
  const y = minY - group.paddingTop;
  return {
    x: Number(x.toFixed(4)),
    y: Number(y.toFixed(4)),
    width: Number((maxX - minX + group.paddingLeft + group.paddingRight).toFixed(4)),
    height: Number((maxY - minY + group.paddingTop + group.paddingBottom).toFixed(4)),
    effectiveRows: Math.max(1, maxRow + 1),
    effectiveColumns: Math.max(1, maxColumn + 1),
    seatCount: groupSeats.length,
  };
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
