export type CobrancaPaymentRules = {
  interestValue: number | null;
  fineValue: number | null;
  fineType: string | null;
  discountValue: number | null;
  discountType: string | null;
  discountDueDateLimitDays: number | null;
};

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function paymentRulesFromParticipantSnapshot(value: unknown): CobrancaPaymentRules | null {
  if (!value || typeof value !== 'object') return null;
  const snapshot = value as Record<string, unknown>;
  const interestValue = numberOrNull(snapshot.interestPercent);
  const fine = snapshot.fine && typeof snapshot.fine === 'object'
    ? snapshot.fine as Record<string, unknown>
    : null;
  const discount = snapshot.discount && typeof snapshot.discount === 'object'
    ? snapshot.discount as Record<string, unknown>
    : null;
  const fineValue = numberOrNull(fine?.value);
  const discountValue = numberOrNull(discount?.value);
  if (interestValue == null && fineValue == null && discountValue == null) return null;

  return {
    interestValue,
    fineValue,
    fineType: typeof fine?.type === 'string' ? fine.type : 'PERCENTAGE',
    discountValue,
    discountType: typeof discount?.type === 'string' ? discount.type : 'PERCENTAGE',
    discountDueDateLimitDays: discountValue == null ? null : Number(discount?.dueDateLimitDays ?? 0),
  };
}

export function mapPaymentRulesToCobrancaFields(rules: CobrancaPaymentRules | null) {
  if (!rules) return {};

  return {
    jurosPercentual: rules.interestValue,
    multaTipo: rules.fineType === 'PERCENTAGE' ? 'PERCENTUAL' : rules.fineType === 'FIXED' ? 'VALOR_FIXO' : null,
    multaPercentual: rules.fineType === 'PERCENTAGE' ? rules.fineValue : null,
    multaValorFixo: rules.fineType === 'FIXED' ? rules.fineValue : null,
    descontoTipo: rules.discountType === 'PERCENTAGE' ? 'PERCENTUAL' : rules.discountType === 'FIXED' ? 'VALOR_FIXO' : null,
    descontoPercentual: rules.discountType === 'PERCENTAGE' ? rules.discountValue : null,
    descontoValorFixo: rules.discountType === 'FIXED' ? rules.discountValue : null,
    descontoPrazoMaximo: rules.discountDueDateLimitDays == null
      ? null
      : rules.discountDueDateLimitDays === 0
        ? 'ATE_VENCIMENTO'
        : `${rules.discountDueDateLimitDays}_DIAS`,
  };
}
