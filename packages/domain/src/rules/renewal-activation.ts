export type RenewalActivationBlocker =
  | 'EFFECTIVE_DATE_NOT_REACHED'
  | 'SOURCE_ENROLLMENT_OVERLAP'
  | 'RESERVATION_MISSING'
  | 'FUTURE_ENROLLMENT_MISSING'
  | 'CONTRACT_NOT_SIGNED'
  | 'FINANCE_NOT_PROVISIONED'
  | 'FINANCIAL_PROVISION_FAILED'
  | 'OPEN_BLOCKING_PENDING';

export type EvaluateRenewalActivationInput = {
  now: Date;
  effectiveAt: Date;
  sourceOverlapsEffectiveAt: boolean;
  hasFutureEnrollment: boolean;
  hasReservation: boolean;
  contractRequired: boolean;
  contractStatus?: 'DRAFT' | 'WAITING_SIGNATURE' | 'SIGNED_SCHEDULED' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED' | null;
  financeRequired: boolean;
  financeStatus?: 'NOT_PREPARED' | 'SCHEDULED' | 'READY_TO_PROVISION' | 'PROVISIONING' | 'ACTIVE' | 'FAILED' | 'CANCELLED' | null;
  hasOpenBlockingPending: boolean;
};

export function evaluateRenewalActivation(
  input: EvaluateRenewalActivationInput,
): { eligible: boolean; blockers: RenewalActivationBlocker[] } {
  const blockers: RenewalActivationBlocker[] = [];

  if (input.now.getTime() < input.effectiveAt.getTime()) blockers.push('EFFECTIVE_DATE_NOT_REACHED');
  if (input.sourceOverlapsEffectiveAt) blockers.push('SOURCE_ENROLLMENT_OVERLAP');
  if (!input.hasFutureEnrollment) blockers.push('FUTURE_ENROLLMENT_MISSING');
  if (!input.hasReservation) blockers.push('RESERVATION_MISSING');
  if (input.contractRequired && input.contractStatus !== 'SIGNED_SCHEDULED' && input.contractStatus !== 'ACTIVE') {
    blockers.push('CONTRACT_NOT_SIGNED');
  }
  if (input.financeRequired && input.financeStatus === 'FAILED') {
    blockers.push('FINANCIAL_PROVISION_FAILED');
  } else if (input.financeRequired && input.financeStatus !== 'ACTIVE') {
    blockers.push('FINANCE_NOT_PROVISIONED');
  }
  if (input.hasOpenBlockingPending) blockers.push('OPEN_BLOCKING_PENDING');

  return { eligible: blockers.length === 0, blockers };
}
