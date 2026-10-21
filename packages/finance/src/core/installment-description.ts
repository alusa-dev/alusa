/** Adds the locally known installment ordinal while preserving the base label. */
export function formatInstallmentDescription(
  ordinal: number | null | undefined,
  total: number,
  description: string | null | undefined,
): string | null {
  const base = description?.trim() ?? '';
  if (!Number.isInteger(ordinal) || !Number.isInteger(total) || ordinal! < 1 || total < ordinal!) {
    return base || null;
  }

  const marker = String.raw`Parcela(?:\s+acad\.)?\s+\d+\s*\/\s*\d+`;
  const withoutPrefix = base.replace(new RegExp(String.raw`^${marker}(?:\s*[-–—:]\s*|$)`, 'i'), '').trim();
  const withoutOrdinal = withoutPrefix
    .replace(new RegExp(String.raw`\s*[-–—:]\s*${marker}\s*$`, 'i'), '')
    .trim();
  return withoutOrdinal
    ? `Parcela ${ordinal}/${total} - ${withoutOrdinal}`
    : `Parcela ${ordinal}/${total}`;
}

/** Parses a local installment marker at a description boundary; provider IDs are never ordinals. */
export function parseInstallmentDescriptionIndex(
  description: string | null | undefined,
  total: number,
): number | null {
  const value = description?.trim() ?? '';
  const markerPattern = String.raw`Parcela(?:\s+acad\.)?\s+(\d+)\s*\/\s*(\d+)`;
  const match = new RegExp(String.raw`^${markerPattern}(?:\s*[-–—:]\s*|$)`, 'i').exec(value)
    ?? new RegExp(String.raw`[-–—:]\s*${markerPattern}\s*$`, 'i').exec(value);
  if (!match) return null;
  const ordinal = Number(match[1]);
  return Number.isInteger(ordinal) && ordinal >= 1 && ordinal <= total && Number(match[2]) === total
    ? ordinal
    : null;
}
