export type SeatGridNumberingDirection = 'left-to-right' | 'right-to-left';

export type SeatGridConfig = {
  totalSeats: number;
  rows: number;
  columns: number;
  seatSize: number;
  horizontalSpacing: number;
  verticalSpacing: number;
  rowPrefix: string;
  startNumber: number;
  numberingDirection: SeatGridNumberingDirection;
};

export type SeatGridPreviewSeat = {
  x: number;
  y: number;
  size: number;
  rowLabel: string;
  seatNumber: string;
  displayLabel: string;
  technicalCode: string;
  rowIndex: number;
  columnIndex: number;
};

export type SeatGridSequenceSeat = {
  levelId?: string | null;
  rowLabel?: string | null;
  seatNumber?: string | null;
  displayLabel?: string | null;
  x?: number | null;
  y?: number | null;
  size?: number | null;
};

export const SEAT_GRID_SECTION_PADDING = 24;

export const DEFAULT_SEAT_GRID_CONFIG: SeatGridConfig = {
  totalSeats: 32,
  rows: 4,
  columns: 8,
  seatSize: 24,
  horizontalSpacing: 34,
  verticalSpacing: 34,
  rowPrefix: 'A',
  startNumber: 1,
  numberingDirection: 'left-to-right',
};

function clampInteger(value: unknown, min: number, max: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function lettersToIndex(value: string) {
  return value.split('').reduce((total, char) => total * 26 + (char.charCodeAt(0) - 64), 0) - 1;
}

function indexToLetters(index: number) {
  let remaining = Math.max(0, index) + 1;
  let label = '';

  while (remaining > 0) {
    const modulo = (remaining - 1) % 26;
    label = String.fromCharCode(65 + modulo) + label;
    remaining = Math.floor((remaining - modulo) / 26);
  }

  return label;
}

export function normalizeSeatGridConfig(config: Partial<SeatGridConfig>): SeatGridConfig {
  const rows = clampInteger(config.rows ?? DEFAULT_SEAT_GRID_CONFIG.rows, 1, 50);
  const columns = clampInteger(config.columns ?? DEFAULT_SEAT_GRID_CONFIG.columns, 1, 80);
  const capacity = rows * columns;
  return {
    totalSeats: clampInteger(config.totalSeats ?? Math.min(DEFAULT_SEAT_GRID_CONFIG.totalSeats, capacity), 1, capacity),
    rows,
    columns,
    seatSize: clampInteger(config.seatSize ?? DEFAULT_SEAT_GRID_CONFIG.seatSize, 12, 80),
    horizontalSpacing: clampInteger(config.horizontalSpacing ?? DEFAULT_SEAT_GRID_CONFIG.horizontalSpacing, 12, 200),
    verticalSpacing: clampInteger(config.verticalSpacing ?? DEFAULT_SEAT_GRID_CONFIG.verticalSpacing, 12, 200),
    rowPrefix: String(config.rowPrefix ?? DEFAULT_SEAT_GRID_CONFIG.rowPrefix).trim() || DEFAULT_SEAT_GRID_CONFIG.rowPrefix,
    startNumber: clampInteger(config.startNumber ?? DEFAULT_SEAT_GRID_CONFIG.startNumber, 1, 9999),
    numberingDirection: config.numberingDirection === 'right-to-left' ? 'right-to-left' : 'left-to-right',
  };
}

export function getSeatGridCapacity(config: Pick<SeatGridConfig, 'rows' | 'columns'>) {
  return Math.max(0, Math.round(config.rows) * Math.round(config.columns));
}

export function getSeatGridRowLabel(rowIndex: number, rowPrefix: string) {
  const normalizedPrefix = rowPrefix.trim().toUpperCase();
  if (/^[A-Z]+$/.test(normalizedPrefix)) {
    return indexToLetters(lettersToIndex(normalizedPrefix) + rowIndex);
  }
  return `${rowPrefix.trim() || DEFAULT_SEAT_GRID_CONFIG.rowPrefix}${rowIndex + 1}`;
}

function parseSeatRowLabel(seat: SeatGridSequenceSeat) {
  const directRowLabel = seat.rowLabel?.trim().toUpperCase();
  if (directRowLabel && /^[A-Z]+$/.test(directRowLabel)) return directRowLabel;

  const displayLabel = seat.displayLabel?.trim().toUpperCase();
  const match = displayLabel?.match(/^([A-Z]+)\d+$/);
  return match?.[1] ?? null;
}

function parseSeatNumber(seat: SeatGridSequenceSeat) {
  const directSeatNumber = Number(seat.seatNumber);
  if (Number.isFinite(directSeatNumber) && directSeatNumber > 0) return Math.round(directSeatNumber);

  const displayLabel = seat.displayLabel?.trim().toUpperCase();
  const match = displayLabel?.match(/^[A-Z]+(\d+)$/);
  const parsed = Number(match?.[1]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function inferLastSeatGridPreset(seats: SeatGridSequenceSeat[], levelId: string | null | undefined) {
  const usableSeats = seats.filter((seat) => {
    if (levelId && seat.levelId && seat.levelId !== levelId) return false;
    return typeof seat.x === 'number' && typeof seat.y === 'number';
  });
  if (usableSeats.length === 0) return {};

  const sortedByPosition = [...usableSeats].sort((a, b) => {
    const ay = Number(a.y ?? 0);
    const by = Number(b.y ?? 0);
    if (Math.abs(ay - by) > 0.5) return ay - by;
    return Number(a.x ?? 0) - Number(b.x ?? 0);
  });
  const lastSeat = sortedByPosition.at(-1);
  const lastSize = typeof lastSeat?.size === 'number' ? lastSeat.size : undefined;

  const rows = new Map<string, SeatGridSequenceSeat[]>();
  for (const seat of usableSeats) {
    const rowKey = Number(seat.y).toFixed(2);
    rows.set(rowKey, [...(rows.get(rowKey) ?? []), seat]);
  }

  const horizontalSpacingCandidates: number[] = [];
  for (const rowSeats of rows.values()) {
    const sortedRowSeats = [...rowSeats].sort((a, b) => Number(a.x) - Number(b.x));
    for (let index = 1; index < sortedRowSeats.length; index += 1) {
      const spacing = Number(sortedRowSeats[index]?.x) - Number(sortedRowSeats[index - 1]?.x);
      if (spacing > 0.5) horizontalSpacingCandidates.push(spacing);
    }
  }

  const sortedRowYs = [...rows.keys()].map(Number).sort((a, b) => a - b);
  const verticalSpacingCandidates: number[] = [];
  for (let index = 1; index < sortedRowYs.length; index += 1) {
    const spacing = sortedRowYs[index]! - sortedRowYs[index - 1]!;
    if (spacing > 0.5) verticalSpacingCandidates.push(spacing);
  }

  const median = (values: number[]) => {
    if (values.length === 0) return undefined;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor((sorted.length - 1) / 2)];
  };

  return {
    seatSize: lastSize,
    horizontalSpacing: median(horizontalSpacingCandidates),
    verticalSpacing: median(verticalSpacingCandidates),
  };
}

export function suggestNextSeatGridConfig(
  seats: SeatGridSequenceSeat[],
  levelId: string | null | undefined,
  baseConfig: SeatGridConfig = DEFAULT_SEAT_GRID_CONFIG,
): SeatGridConfig {
  let maxRowIndex = -1;
  let maxSeatNumberInMaxRow = 0;
  const inheritedPreset = inferLastSeatGridPreset(seats, levelId);

  for (const seat of seats) {
    if (levelId && seat.levelId && seat.levelId !== levelId) continue;
    const rowLabel = parseSeatRowLabel(seat);
    if (!rowLabel) continue;
    const rowIndex = lettersToIndex(rowLabel);
    const seatNumber = parseSeatNumber(seat) ?? 0;
    if (rowIndex > maxRowIndex) {
      maxRowIndex = rowIndex;
      maxSeatNumberInMaxRow = seatNumber;
      continue;
    }
    if (rowIndex === maxRowIndex) {
      maxSeatNumberInMaxRow = Math.max(maxSeatNumberInMaxRow, seatNumber);
    }
  }

  if (maxRowIndex < 0) return normalizeSeatGridConfig({ ...baseConfig, ...inheritedPreset });

  return normalizeSeatGridConfig({
    ...baseConfig,
    ...inheritedPreset,
    rowPrefix: indexToLetters(maxRowIndex),
    startNumber: maxSeatNumberInMaxRow + 1,
  });
}

export function buildSeatGridPreview(
  origin: { x: number; y: number },
  rawConfig: Partial<SeatGridConfig>,
): SeatGridPreviewSeat[] {
  const config = normalizeSeatGridConfig(rawConfig);
  const seats: SeatGridPreviewSeat[] = [];

  for (let rowIndex = 0; rowIndex < config.rows; rowIndex += 1) {
    const rowLabel = getSeatGridRowLabel(rowIndex, config.rowPrefix);

    for (let columnIndex = 0; columnIndex < config.columns; columnIndex += 1) {
      if (seats.length >= config.totalSeats) return seats;

      const visualColumnIndex =
        config.numberingDirection === 'right-to-left'
          ? config.columns - columnIndex - 1
          : columnIndex;
      const seatNumber = String(config.startNumber + columnIndex);
      const displayLabel = `${rowLabel}${seatNumber}`;

      seats.push({
        x: origin.x + visualColumnIndex * config.horizontalSpacing,
        y: origin.y + rowIndex * config.verticalSpacing,
        size: config.seatSize,
        rowLabel,
        seatNumber,
        displayLabel,
        technicalCode: displayLabel,
        rowIndex,
        columnIndex,
      });
    }
  }

  return seats;
}

export function getSeatGridPreviewBounds(seats: SeatGridPreviewSeat[], padding = 0) {
  if (seats.length === 0) return null;

  const bounds = seats.reduce(
    (current, seat) => {
      const radius = seat.size / 2;
      return {
        minX: Math.min(current.minX, seat.x - radius),
        minY: Math.min(current.minY, seat.y - radius),
        maxX: Math.max(current.maxX, seat.x + radius),
        maxY: Math.max(current.maxY, seat.y + radius),
      };
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );

  return {
    x: bounds.minX - padding,
    y: bounds.minY - padding,
    width: bounds.maxX - bounds.minX + padding * 2,
    height: bounds.maxY - bounds.minY + padding * 2,
  };
}
