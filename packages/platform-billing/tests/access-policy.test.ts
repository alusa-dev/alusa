import { describe, expect, it } from 'vitest';
import {
  assertPlatformAccess,
  computeGracePeriodEnd,
  derivePlatformAccessStatus,
  type PlatformBillingAccountRecord,
} from '../src';

describe('@alusa/platform-billing access policy', () => {
  it('mantem billing disponivel em RESTRICTED e bloqueia escrita educacional', () => {
    const account = buildAccount({ accessStatus: 'RESTRICTED', status: 'UNPAID' });

    expect(assertPlatformAccess({ contaId: 'conta_1', account, capability: 'BILLING_MANAGE' })).toBe('RESTRICTED');
    expect(() => assertPlatformAccess({ contaId: 'conta_1', account, capability: 'STUDENT_WRITE' }))
      .toThrowError(/restricted/i);
  });

  it('mantem saldo, historico e transferencias disponiveis em RESTRICTED', () => {
    const account = buildAccount({ accessStatus: 'RESTRICTED', status: 'UNPAID' });

    expect(assertPlatformAccess({ contaId: 'conta_1', account, capability: 'MONEY_READ' })).toBe('RESTRICTED');
    expect(assertPlatformAccess({ contaId: 'conta_1', account, capability: 'MONEY_TRANSFER' })).toBe('RESTRICTED');
    expect(assertPlatformAccess({ contaId: 'conta_1', account, capability: 'MONEY_WITHDRAW' })).toBe('RESTRICTED');
  });

  it('move grace expirado para RESTRICTED', () => {
    const account = buildAccount({
      status: 'PAST_DUE',
      accessStatus: 'GRACE_PERIOD',
      gracePeriodEndsAt: new Date('2026-06-01T00:00:00.000Z'),
    });

    expect(derivePlatformAccessStatus({
      account,
      now: new Date('2026-06-08T00:00:00.000Z'),
    })).toBe('RESTRICTED');
  });

  it('restringe trial expirado mesmo antes do webhook de pausa', () => {
    const account = buildAccount({
      status: 'TRIALING',
      accessStatus: 'ACTIVE',
      trialEndsAt: new Date('2026-07-15T00:00:00.000Z'),
    });

    expect(derivePlatformAccessStatus({
      account,
      now: new Date('2026-07-16T00:00:00.000Z'),
    })).toBe('RESTRICTED');
  });

  it('calcula grace period central de 7 dias', () => {
    expect(computeGracePeriodEnd({ failedAt: new Date('2026-06-01T00:00:00.000Z') }).toISOString())
      .toBe('2026-06-08T00:00:00.000Z');
  });
});

function buildAccount(input: Partial<PlatformBillingAccountRecord>): PlatformBillingAccountRecord {
  return {
    id: 'pba_1',
    contaId: 'conta_1',
    environment: 'TEST',
    status: 'ACTIVE',
    accessStatus: 'ACTIVE',
    planCode: 'STARTER',
    stripeCustomerId: 'cus_1',
    stripeSubscriptionId: 'sub_1',
    stripePriceId: 'price_1',
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    trialEndsAt: null,
    trialWillEndNotifiedAt: null,
    gracePeriodEndsAt: null,
    restrictedAt: null,
    canceledAt: null,
    lastPaymentFailedAt: null,
    lastReconciledAt: null,
    pendingPlanCode: null,
    pendingChangeType: null,
    pendingChangeEffectiveAt: null,
    ...input,
  };
}
