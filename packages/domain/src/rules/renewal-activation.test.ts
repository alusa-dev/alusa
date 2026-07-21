import { describe, expect, it } from 'vitest';
import { evaluateRenewalActivation } from './renewal-activation';

const base = {
  now: new Date('2027-01-08T12:00:00.000Z'),
  effectiveAt: new Date('2027-01-08T00:00:00.000Z'),
  sourceOverlapsEffectiveAt: false,
  hasFutureEnrollment: true,
  hasReservation: true,
  contractRequired: true,
  contractStatus: 'SIGNED_SCHEDULED' as const,
  financeRequired: true,
  financeStatus: 'ACTIVE' as const,
  hasOpenBlockingPending: false,
};

describe('evaluateRenewalActivation', () => {
  it('permite efetivacao quando todos os pre-requisitos estao atendidos', () => {
    expect(evaluateRenewalActivation(base)).toEqual({ eligible: true, blockers: [] });
  });

  it('bloqueia contrato ainda aguardando assinatura', () => {
    expect(evaluateRenewalActivation({ ...base, contractStatus: 'WAITING_SIGNATURE' })).toEqual({
      eligible: false,
      blockers: ['CONTRACT_NOT_SIGNED'],
    });
  });

  it('bloqueia financeiro agendado mas ainda nao provisionado', () => {
    expect(evaluateRenewalActivation({ ...base, financeStatus: 'SCHEDULED' })).toEqual({
      eligible: false,
      blockers: ['FINANCE_NOT_PROVISIONED'],
    });
  });
});
