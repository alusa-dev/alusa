export type InstallmentPlanLifecycleStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELED';

export type InstallmentChargeLifecycleStatus = 'PAID' | 'CANCELED' | 'OPEN';

/**
 * Deriva o estado consolidado do parcelamento a partir das parcelas já
 * persistidas. O chamador deve fornecer estados que já tenham sido
 * reconciliados com o provedor quando houver integração externa.
 */
export function deriveInstallmentPlanLifecycleStatus(input: {
  currentStatus: InstallmentPlanLifecycleStatus;
  chargeStatuses: readonly InstallmentChargeLifecycleStatus[];
}): InstallmentPlanLifecycleStatus {
  if (input.chargeStatuses.length === 0) return input.currentStatus;

  const allCanceled = input.chargeStatuses.every((status) => status === 'CANCELED');
  if (allCanceled) return 'CANCELED';

  const allSettled = input.chargeStatuses.every(
    (status) => status === 'PAID' || status === 'CANCELED',
  );
  if (allSettled && input.chargeStatuses.some((status) => status === 'PAID')) {
    return 'COMPLETED';
  }

  return 'ACTIVE';
}
