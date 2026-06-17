const BRAZIL_TIMEZONE = 'America/Sao_Paulo';

export function formatDateOnlyInBrazil(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: BRAZIL_TIMEZONE });
}

export function todayInBrazil(): string {
  return formatDateOnlyInBrazil(new Date());
}

/**
 * Asaas exige effectiveDate >= data atual (fuso do emissor).
 * Usa vencimento da cobrança quando futuro; caso contrário, hoje.
 */
export function resolveInvoiceEffectiveDate(
  candidate?: Date | string | null,
  override?: string | null,
): string {
  const today = todayInBrazil();

  if (override?.trim()) {
    return override.trim();
  }

  if (candidate instanceof Date && !Number.isNaN(candidate.getTime())) {
    const candidateStr = formatDateOnlyInBrazil(candidate);
    return candidateStr >= today ? candidateStr : today;
  }

  if (typeof candidate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(candidate)) {
    return candidate >= today ? candidate : today;
  }

  return today;
}

export function isInvoiceEffectiveDateValid(effectiveDate: string, referenceDate = todayInBrazil()): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) && effectiveDate >= referenceDate;
}
