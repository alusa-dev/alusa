import type { SeatNumberingConfig } from './types.js';

const ROMAN_NUMERALS: [number, string][] = [
  [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
  [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
  [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
];

function toRoman(n: number): string {
  let result = '';
  for (const [value, numeral] of ROMAN_NUMERALS) {
    while (n >= value) {
      result += numeral;
      n -= value;
    }
  }
  return result;
}

function numberToDoubleAlpha(n: number): string {
  // 0 → AA, 1 → AB, ...
  const first = Math.floor(n / 26);
  const second = n % 26;
  return String.fromCharCode(65 + first) + String.fromCharCode(65 + second);
}

export function getRowLabel(
  rowIndex: number,
  config: Pick<SeatNumberingConfig, 'rowLabelStart' | 'rowLabelFormat' | 'rowDirection'>,
  totalRows: number,
): string {
  const effectiveIndex =
    config.rowDirection === 'BOTTOM_TO_TOP' ? totalRows - 1 - rowIndex : rowIndex;

  switch (config.rowLabelFormat) {
    case 'A':
      return String.fromCharCode(65 + effectiveIndex);
    case 'AA':
      return numberToDoubleAlpha(effectiveIndex);
    case 'ROMAN':
      return toRoman(effectiveIndex + 1);
    case '01':
      return String(effectiveIndex + 1).padStart(2, '0');
    default:
      return String.fromCharCode(65 + effectiveIndex);
  }
}

export function getSeatNumber(
  columnIndex: number,
  config: Pick<SeatNumberingConfig, 'seatNumberStart' | 'columnDirection'>,
  totalColumns: number,
): number {
  const effectiveIndex =
    config.columnDirection === 'RIGHT_TO_LEFT' ? totalColumns - 1 - columnIndex : columnIndex;
  return config.seatNumberStart + effectiveIndex;
}

/** Retorna label estável baseado em rowIndex/columnIndex — nunca posição física. */
export function getSeatLabel(input: {
  rowIndex: number;
  columnIndex: number;
  numbering: SeatNumberingConfig;
  totalRows: number;
  totalColumns: number;
}): string {
  const { rowIndex, columnIndex, numbering, totalRows, totalColumns } = input;
  const rowLabel = getRowLabel(rowIndex, numbering, totalRows);
  const seatNum = getSeatNumber(columnIndex, numbering, totalColumns);
  return `${rowLabel}${numbering.separator}${seatNum}`;
}
