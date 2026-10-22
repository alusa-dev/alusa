export type ResolveAsaasProcessingFeeInput = {
  explicitFee: number | null;
  grossValue: number | null;
  netValue: number | null;
};

/** Resolves a recorded Asaas processing fee only when it agrees with gross minus net. */
export function resolveAsaasProcessingFee({
  explicitFee,
  grossValue,
  netValue,
}: ResolveAsaasProcessingFeeInput): number | null {
  if (
    grossValue === null ||
    netValue === null ||
    !Number.isFinite(grossValue) ||
    !Number.isFinite(netValue) ||
    grossValue < 0 ||
    netValue < 0 ||
    grossValue < netValue
  ) {
    return null;
  }

  const derivedFee = Number((grossValue - netValue).toFixed(2));
  if (explicitFee === null) return derivedFee;
  if (!Number.isFinite(explicitFee) || explicitFee < 0) return null;

  return Math.abs(explicitFee - derivedFee) <= 0.01 ? explicitFee : null;
}
