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

export type EnrollmentStartDecision =
  | { action: 'TRANSITION'; targetStatus: 'PENDENTE_TAXA' | 'ATIVA' }
  | { action: 'KEEP'; reason: 'STATUS_NOT_WAITING_FOR_START' | 'FEE_NOT_PAID' };

/**
 * Decide the academic status when a scheduled enrollment reaches its start date.
 * Financial state is supplied as input; this function does not inspect charges.
 */
export function decideEnrollmentStatusAtContractStart(input: {
  enrollmentStatus: EnrollmentActivationStatus;
  activationPolicy: EnrollmentActivationPolicy;
  feeRequired: boolean;
  feeStatus: EnrollmentFeeStatus;
}): EnrollmentStartDecision {
  const feeIsPending = input.feeRequired && input.feeStatus !== 'PAGO';

  if (input.enrollmentStatus === 'AGUARDANDO_CONFIRMACAO') {
    return input.activationPolicy === 'REQUIRES_PAYMENT' && feeIsPending
      ? { action: 'TRANSITION', targetStatus: 'PENDENTE_TAXA' }
      : { action: 'TRANSITION', targetStatus: 'ATIVA' };
  }

  if (input.enrollmentStatus === 'PENDENTE_TAXA') {
    return input.activationPolicy === 'REQUIRES_PAYMENT' && feeIsPending
      ? { action: 'KEEP', reason: 'FEE_NOT_PAID' }
      : { action: 'TRANSITION', targetStatus: 'ATIVA' };
  }

  return { action: 'KEEP', reason: 'STATUS_NOT_WAITING_FOR_START' };
}

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
