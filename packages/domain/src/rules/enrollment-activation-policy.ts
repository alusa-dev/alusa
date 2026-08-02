export type EnrollmentActivationPolicy = 'IMMEDIATE' | 'REQUIRES_PAYMENT';
export type EnrollmentActivationStatus =
  | 'PENDENTE_TAXA'
  | 'AGUARDANDO_CONFIRMACAO'
  | 'ATIVA'
  | 'PAUSADA'
  | 'ENCERRADA'
  | 'RECUSADA'
  | 'CANCELADA';
export type EnrollmentFeeStatus = 'PENDENTE' | 'PAGO' | 'EXPIRADO' | 'ISENTO';

export type EnrollmentActivationDecision =
  | { action: 'ACTIVATE'; reason: 'PAYMENT_CONFIRMED' }
  | {
      action: 'KEEP';
      reason: 'POLICY_IMMEDIATE' | 'FEE_NOT_PAID' | 'STATUS_NOT_PENDING_FEE';
    };

export function decideEnrollmentActivationAfterFee(input: {
  activationPolicy: EnrollmentActivationPolicy;
  enrollmentStatus: EnrollmentActivationStatus;
  feeStatus: EnrollmentFeeStatus;
}): EnrollmentActivationDecision {
  if (input.activationPolicy !== 'REQUIRES_PAYMENT') {
    return { action: 'KEEP', reason: 'POLICY_IMMEDIATE' };
  }
  if (input.enrollmentStatus !== 'PENDENTE_TAXA') {
    return { action: 'KEEP', reason: 'STATUS_NOT_PENDING_FEE' };
  }
  if (input.feeStatus !== 'PAGO') {
    return { action: 'KEEP', reason: 'FEE_NOT_PAID' };
  }
  return { action: 'ACTIVATE', reason: 'PAYMENT_CONFIRMED' };
}
