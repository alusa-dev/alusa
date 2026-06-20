const CHARGE_TIPO_LABELS: Record<string, string> = {
  MENSALIDADE: 'Mensalidade',
  TAXA_MATRICULA: 'Taxa de Matrícula',
  EXTRA: 'Extra',
  AVULSA: 'Avulsa',
  PARCELADA: 'Parcelamento',
  RECORRENTE: 'Assinatura',
  EVENTO: 'Eventos',
};

function isFamilyEnrollmentFeeDescription(description?: string | null): boolean {
  return description?.trim().toLowerCase().startsWith('taxa de matrícula familiar') ?? false;
}

function isRematriculaTaxDescription(description?: string | null): boolean {
  const normalized = description?.trim() ?? '';
  if (!normalized) return false;
  return /rematr[íi]cula/i.test(normalized);
}

export function getChargeTipoLabel(
  tipo: string | null | undefined,
  description?: string | null,
): string {
  const key = tipo ?? '';
  if (key === 'TAXA_MATRICULA' && isRematriculaTaxDescription(description)) {
    return 'Taxa de Rematrícula';
  }
  if (isFamilyEnrollmentFeeDescription(description)) {
    return 'Taxa de Matrícula';
  }
  return CHARGE_TIPO_LABELS[key] ?? key;
}
