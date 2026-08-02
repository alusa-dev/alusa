import { describe, expect, it } from 'vitest';
import { decideEnrollmentActivationAfterFee } from './enrollment-activation-policy';

describe('decideEnrollmentActivationAfterFee', () => {
  it('ativa somente matrícula pendente quando a política exige pagamento e a taxa foi paga', () => {
    expect(
      decideEnrollmentActivationAfterFee({
        activationPolicy: 'REQUIRES_PAYMENT',
        enrollmentStatus: 'PENDENTE_TAXA',
        feeStatus: 'PAGO',
      }),
    ).toEqual({ action: 'ACTIVATE', reason: 'PAYMENT_CONFIRMED' });
  });

  it.each([
    ['IMMEDIATE', 'PENDENTE_TAXA', 'PAGO', 'POLICY_IMMEDIATE'],
    ['REQUIRES_PAYMENT', 'ATIVA', 'PAGO', 'STATUS_NOT_PENDING_FEE'],
    ['REQUIRES_PAYMENT', 'PENDENTE_TAXA', 'PENDENTE', 'FEE_NOT_PAID'],
  ] as const)('mantém o estado para %s/%s/%s', (activationPolicy, enrollmentStatus, feeStatus, reason) => {
    expect(
      decideEnrollmentActivationAfterFee({ activationPolicy, enrollmentStatus, feeStatus }),
    ).toEqual({ action: 'KEEP', reason });
  });
});
