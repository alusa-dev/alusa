export type Rect = { x: number; y: number; width: number; height: number };

export function intersects(a: Rect, b: Rect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function gapBetweenHorizontal(left: Rect, right: Rect) {
  return right.x - (left.x + left.width);
}

export function gapBetweenVertical(top: Rect, bottom: Rect) {
  return bottom.y - (top.y + top.height);
}

export function roundGeometry<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => (typeof item === 'number' ? Math.round(item * 100) / 100 : item)),
  );
}

export function assertNoSeatOverlaps(seats: Array<{ id: string; bounds: Rect }>) {
  for (let i = 0; i < seats.length; i++) {
    for (let j = i + 1; j < seats.length; j++) {
      if (intersects(seats[i]!.bounds, seats[j]!.bounds)) {
        throw new Error(`Seat overlap: ${seats[i]!.id} with ${seats[j]!.id}`);
      }
    }
  }
}

export function assertNoSeatIntersectsCorridors(
  seats: Array<{ id: string; bounds: Rect }>,
  corridors: Array<{ id: string; coreRect: Rect; clearanceRect: Rect }>,
) {
  for (const seat of seats) {
    for (const corridor of corridors) {
      if (intersects(seat.bounds, corridor.coreRect)) {
        throw new Error(`Seat ${seat.id} intersects corridor core ${corridor.id}`);
      }
      if (intersects(seat.bounds, corridor.clearanceRect)) {
        throw new Error(`Seat ${seat.id} intersects corridor clearance ${corridor.id}`);
      }
    }
  }
}

export type SeatGeometry = {
  id: string;
  label: string;
  rowLabel: string | null;
  seatNumber: string | null;
  x: number;
  y: number;
  size: number;
  bounds: Rect;
};

export function findSeat(seats: SeatGeometry[], rowLabel: string, seatNumber: string | number) {
  const seat = seats.find(
    (entry) => entry.rowLabel === rowLabel && String(entry.seatNumber) === String(seatNumber),
  );
  if (!seat) throw new Error(`Seat ${rowLabel}${seatNumber} not found`);
  return seat;
}

export function seatsInRow(seats: SeatGeometry[], rowLabel: string) {
  return seats
    .filter((seat) => seat.rowLabel === rowLabel)
    .sort((left, right) => Number(left.seatNumber) - Number(right.seatNumber));
}

export function seatsInColumn(seats: SeatGeometry[], seatNumber: string | number) {
  return seats
    .filter((seat) => String(seat.seatNumber) === String(seatNumber))
    .sort((left, right) => String(left.rowLabel ?? '').localeCompare(String(right.rowLabel ?? '')));
}

export function geometrySnapshot(seats: SeatGeometry[]) {
  return roundGeometry(
    seats.map((seat) => ({
      id: seat.id,
      label: seat.label,
      x: seat.x,
      y: seat.y,
    })),
  );
}

export function columnGapCenter(seats: SeatGeometry[], leftCol: number, rightCol: number, rowLabel = 'A') {
  const left = findSeat(seats, rowLabel, leftCol);
  const right = findSeat(seats, rowLabel, rightCol);
  const gapStart = left.bounds.x + left.bounds.width;
  const gapEnd = right.bounds.x;
  return {
    x: (gapStart + gapEnd) / 2,
    y: left.y,
    gap: gapEnd - gapStart,
  };
}

export function rowGapCenter(seats: SeatGeometry[], topRow: string, bottomRow: string, colNumber = 1) {
  const top = findSeat(seats, topRow, colNumber);
  const bottom = findSeat(seats, bottomRow, colNumber);
  const gapStart = top.bounds.y + top.bounds.height;
  const gapEnd = bottom.bounds.y;
  return {
    x: top.x,
    y: (gapStart + gapEnd) / 2,
    gap: gapEnd - gapStart,
  };
}
