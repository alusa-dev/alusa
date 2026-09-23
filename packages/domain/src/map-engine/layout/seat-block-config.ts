export type SeatBlockNumberingDirection = 'left-to-right' | 'right-to-left';

export type SeatBlockConfig = {
  totalSeats: number;
  rows: number;
  columns: number;
  seatSize: number;
  horizontalSpacing: number;
  verticalSpacing: number;
  rowPrefix: string;
  startNumber: number;
  numberingDirection: SeatBlockNumberingDirection;
};

export type SeatBlockPreviewSeat = {
  x: number;
  y: number;
  size: number;
  rowLabel: string;
  seatNumber: string;
  displayLabel: string;
  technicalCode: string;
  rowIndex: number;
  columnIndex: number;
  rotation: number;
};

export const SEAT_BLOCK_SECTION_PADDING = 24;
export const DEFAULT_SEAT_BLOCK_CONFIG: SeatBlockConfig = {
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
    remaining = Math.floor((remaining - 1) / 26);
  }
  return label;
}

export function normalizeSeatBlockConfig(config: Partial<SeatBlockConfig>): SeatBlockConfig {
  const rows = clampInteger(config.rows ?? DEFAULT_SEAT_BLOCK_CONFIG.rows, 1, 50);
  const columns = clampInteger(config.columns ?? DEFAULT_SEAT_BLOCK_CONFIG.columns, 1, Number.MAX_SAFE_INTEGER);
  const seatSize = clampInteger(config.seatSize ?? DEFAULT_SEAT_BLOCK_CONFIG.seatSize, 12, 80);
  const minimumSpacing = seatSize + 4;
  const horizontalSpacing = Math.max(minimumSpacing, clampInteger(config.horizontalSpacing ?? DEFAULT_SEAT_BLOCK_CONFIG.horizontalSpacing, 12, 200));
  const verticalSpacing = Math.max(minimumSpacing, clampInteger(config.verticalSpacing ?? DEFAULT_SEAT_BLOCK_CONFIG.verticalSpacing, 12, 200));
  const totalSeats = clampInteger(config.totalSeats ?? Math.min(DEFAULT_SEAT_BLOCK_CONFIG.totalSeats, rows * columns), 1, Number.MAX_SAFE_INTEGER);
  return {
    totalSeats: Math.min(totalSeats, rows * Math.max(columns, Math.ceil(totalSeats / rows))),
    rows,
    columns: Math.max(columns, Math.ceil(totalSeats / rows)),
    seatSize,
    horizontalSpacing,
    verticalSpacing,
    rowPrefix: String(config.rowPrefix ?? DEFAULT_SEAT_BLOCK_CONFIG.rowPrefix).trim() || DEFAULT_SEAT_BLOCK_CONFIG.rowPrefix,
    startNumber: clampInteger(config.startNumber ?? DEFAULT_SEAT_BLOCK_CONFIG.startNumber, 1, 9999),
    numberingDirection: config.numberingDirection === 'right-to-left' ? 'right-to-left' : 'left-to-right',
  };
}

export function getSeatBlockCapacity(config: Pick<SeatBlockConfig, 'rows' | 'columns'>) {
  return Math.max(0, Math.round(config.rows) * Math.round(config.columns));
}

export function getSeatBlockRowLabel(rowIndex: number, rowPrefix: string) {
  const normalized = rowPrefix.trim().toUpperCase();
  return /^[A-Z]+$/.test(normalized) ? indexToLetters(lettersToIndex(normalized) + rowIndex) : `${rowPrefix.trim() || 'A'}${rowIndex + 1}`;
}

/** Pick the next alphabetic row prefix after the labels already used on a map. */
export function getNextSeatBlockRowPrefix(rowLabels: string[]) {
  const indexes = rowLabels
    .map((label) => label.trim().toUpperCase())
    .filter((label) => /^[A-Z]+$/.test(label))
    .map(lettersToIndex);
  return indexToLetters(Math.max(-1, ...indexes) + 1);
}

export function computeSeatBlockSeatLabel(rowIndex: number, columnIndex: number, config: Pick<SeatBlockConfig, 'rowPrefix' | 'startNumber' | 'numberingDirection' | 'columns'>) {
  const rowLabel = getSeatBlockRowLabel(rowIndex, config.rowPrefix);
  const visualColumnIndex = config.numberingDirection === 'right-to-left' ? config.columns - columnIndex - 1 : columnIndex;
  const seatNumber = String(config.startNumber + visualColumnIndex);
  return { rowLabel, seatNumber, displayLabel: `${rowLabel}${seatNumber}` };
}

export function buildSeatBlockPreview(origin: { x: number; y: number }, rawConfig: Partial<SeatBlockConfig>): SeatBlockPreviewSeat[] {
  const config = normalizeSeatBlockConfig(rawConfig);
  const seats: SeatBlockPreviewSeat[] = [];
  for (let rowIndex = 0; rowIndex < config.rows; rowIndex += 1) {
    const rowLabel = getSeatBlockRowLabel(rowIndex, config.rowPrefix);
    for (let columnIndex = 0; columnIndex < config.columns; columnIndex += 1) {
      if (seats.length >= config.totalSeats) return seats;
      const visualColumnIndex = config.numberingDirection === 'right-to-left' ? config.columns - columnIndex - 1 : columnIndex;
      const labels = computeSeatBlockSeatLabel(rowIndex, columnIndex, config);
      const x = origin.x + visualColumnIndex * config.horizontalSpacing;
      const y = origin.y + rowIndex * config.verticalSpacing;
      seats.push({ x, y, size: config.seatSize, rowLabel, seatNumber: labels.seatNumber, displayLabel: labels.displayLabel, technicalCode: labels.displayLabel, rowIndex, columnIndex, rotation: 0 });
    }
  }
  return seats;
}

export function getSeatBlockPreviewBounds(seats: SeatBlockPreviewSeat[], padding = 0) {
  if (seats.length === 0) return null;
  const bounds = seats.reduce((current, seat) => ({
    minX: Math.min(current.minX, seat.x - seat.size / 2),
    minY: Math.min(current.minY, seat.y - seat.size / 2),
    maxX: Math.max(current.maxX, seat.x + seat.size / 2),
    maxY: Math.max(current.maxY, seat.y + seat.size / 2),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  return { x: bounds.minX - padding, y: bounds.minY - padding, width: bounds.maxX - bounds.minX + padding * 2, height: bounds.maxY - bounds.minY + padding * 2 };
}
