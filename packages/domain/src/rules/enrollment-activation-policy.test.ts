import { describe, expect, it } from 'vitest';
import {
  decideEnrollmentActivationAfterFee,
  decideEnrollmentStatusAtContractStart,
} from './enrollment-activation-policy';

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

describe('decideEnrollmentStatusAtContractStart', () => {
  it('ativa matrícula sem taxa ou com taxa isenta ao iniciar', () => {
    expect(decideEnrollmentStatusAtContractStart({
      enrollmentStatus: 'AGUARDANDO_CONFIRMACAO',
      activationPolicy: 'REQUIRES_PAYMENT',
      feeRequired: false,
      feeStatus: 'ISENTO',
    })).toEqual({ action: 'TRANSITION', targetStatus: 'ATIVA' });
  });

  it('move para pendente de taxa quando a política exige pagamento e a taxa não foi paga', () => {
    expect(decideEnrollmentStatusAtContractStart({
      enrollmentStatus: 'AGUARDANDO_CONFIRMACAO',
      activationPolicy: 'REQUIRES_PAYMENT',
      feeRequired: true,
      feeStatus: 'PENDENTE',
    })).toEqual({ action: 'TRANSITION', targetStatus: 'PENDENTE_TAXA' });
  });

  it('ativa quando a taxa exigida já foi confirmada como paga', () => {
    expect(decideEnrollmentStatusAtContractStart({
      enrollmentStatus: 'AGUARDANDO_CONFIRMACAO',
      activationPolicy: 'REQUIRES_PAYMENT',
      feeRequired: true,
      feeStatus: 'PAGO',
    })).toEqual({ action: 'TRANSITION', targetStatus: 'ATIVA' });
  });

  it('mantém status pendente enquanto a taxa exigida não estiver paga', () => {
    expect(decideEnrollmentStatusAtContractStart({
      enrollmentStatus: 'PENDENTE_TAXA',
      activationPolicy: 'REQUIRES_PAYMENT',
      feeRequired: true,
      feeStatus: 'PENDENTE',
    })).toEqual({ action: 'KEEP', reason: 'FEE_NOT_PAID' });
  });

  it('não altera estados acadêmicos fora da ativação inicial', () => {
    expect(decideEnrollmentStatusAtContractStart({
      enrollmentStatus: 'CANCELADA',
      activationPolicy: 'IMMEDIATE',
      feeRequired: false,
      feeStatus: 'ISENTO',
    })).toEqual({ action: 'KEEP', reason: 'STATUS_NOT_WAITING_FOR_START' });
  });
});
