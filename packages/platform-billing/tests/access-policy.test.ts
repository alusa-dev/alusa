import { describe, expect, it } from 'vitest';
import {
  assertPlatformAccess,
  computeGracePeriodEnd,
  derivePlatformBillingCommunication,
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

  it('mantem leitura e Meu Dinheiro, mas bloqueia todos os módulos de escrita', () => {
    const account = buildAccount({ accessStatus: 'RESTRICTED', status: 'UNPAID' });

    expect(assertPlatformAccess({ contaId: 'conta_1', account, capability: 'REPORT_READ' })).toBe('RESTRICTED');
    expect(assertPlatformAccess({ contaId: 'conta_1', account, capability: 'ACCOUNT_READ' })).toBe('RESTRICTED');

    for (const capability of [
      'RESPONSIBLE_WRITE',
      'STAFF_WRITE',
      'CLASS_WRITE',
      'ROOM_WRITE',
      'MODALITY_WRITE',
      'LESSON_WRITE',
      'STORE_WRITE',
      'EVENT_WRITE',
      'ENROLLMENT_WRITE',
      'CONTRACT_WRITE',
      'CHARGE_CREATE',
      'FINANCIAL_CONFIG_WRITE',
    ] as const) {
      expect(() => assertPlatformAccess({ contaId: 'conta_1', account, capability })).toThrowError(/restricted/i);
    }
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

  it('restringe trial expirado persistido como ACTIVE sem forma de pagamento', () => {
    const account = buildAccount({
      status: 'ACTIVE',
      accessStatus: 'ACTIVE',
      trialEndsAt: new Date('2026-07-15T00:00:00.000Z'),
    });

    expect(derivePlatformAccessStatus({
      account,
      hasUsablePaymentMethod: false,
      now: new Date('2026-07-16T00:00:00.000Z'),
    })).toBe('RESTRICTED');
  });

  it('mantem assinatura paga ativa mesmo com trial_end histórico', () => {
    const account = buildAccount({
      status: 'ACTIVE',
      accessStatus: 'ACTIVE',
      trialEndsAt: new Date('2026-07-15T00:00:00.000Z'),
      firstPaidAt: new Date('2026-06-01T00:00:00.000Z'),
      paymentMethodStatus: 'PRESENT',
    });

    expect(derivePlatformAccessStatus({
      account,
      hasUsablePaymentMethod: true,
      now: new Date('2026-07-16T00:00:00.000Z'),
    })).toBe('ACTIVE');
  });

  it('nao bloqueia trial expirado que ja possui historico de pagamento', () => {
    const account = buildAccount({
      status: 'TRIALING',
      accessStatus: 'ACTIVE',
      trialEndsAt: new Date('2026-07-15T00:00:00.000Z'),
      firstPaidAt: new Date('2026-06-01T00:00:00.000Z'),
      paymentMethodStatus: 'PRESENT',
    });

    expect(derivePlatformAccessStatus({
      account,
      now: new Date('2026-07-16T00:00:00.000Z'),
    })).toBe('ACTIVE');
  });

  it('emite aviso global de trial somente nos marcos definidos', () => {
    const account = buildAccount({
      status: 'TRIALING',
      accessStatus: 'ACTIVE',
      trialEndsAt: new Date('2026-08-23T00:00:00.000Z'),
      paymentMethodStatus: 'MISSING',
    });

    expect(derivePlatformBillingCommunication({
      account,
      now: new Date('2026-08-16T00:00:00.000Z'),
    })).toEqual({ level: 'TRIAL_WARNING', noticeKey: 'trial-7' });
  });

  it('abre grace somente para assinatura paga com forma de pagamento presente', () => {
    const account = buildAccount({
      status: 'PAST_DUE',
      accessStatus: 'ACTIVE',
      firstPaidAt: new Date('2026-06-01T00:00:00.000Z'),
      paymentMethodStatus: 'PRESENT',
      gracePeriodEndsAt: new Date('2026-08-20T00:00:00.000Z'),
    });

    expect(derivePlatformAccessStatus({
      account,
      now: new Date('2026-08-16T00:00:00.000Z'),
    })).toBe('GRACE_PERIOD');
  });

  it('restringe PAST_DUE sem histórico pago ou sem forma de pagamento confirmada', () => {
    const trialAccount = buildAccount({
      status: 'PAST_DUE',
      accessStatus: 'GRACE_PERIOD',
      gracePeriodEndsAt: new Date('2026-08-20T00:00:00.000Z'),
      paymentMethodStatus: 'PRESENT',
    });
    const unknownCardAccount = buildAccount({
      status: 'PAST_DUE',
      accessStatus: 'GRACE_PERIOD',
      firstPaidAt: new Date('2026-06-01T00:00:00.000Z'),
      gracePeriodEndsAt: new Date('2026-08-20T00:00:00.000Z'),
      paymentMethodStatus: 'UNKNOWN',
    });

    expect(derivePlatformAccessStatus({ account: trialAccount, now: new Date('2026-08-16T00:00:00.000Z') })).toBe('RESTRICTED');
    expect(derivePlatformAccessStatus({ account: unknownCardAccount, now: new Date('2026-08-16T00:00:00.000Z') })).toBe('RESTRICTED');
  });

  it('mantem acesso até o fim quando a assinatura foi cancelada para o fim do ciclo', () => {
    const account = buildAccount({
      status: 'CANCELED',
      accessStatus: 'CANCELED',
      cancelAtPeriodEnd: true,
      currentPeriodEnd: new Date('2026-08-20T00:00:00.000Z'),
    });

    expect(derivePlatformAccessStatus({ account, now: new Date('2026-08-16T00:00:00.000Z') })).toBe('ACTIVE');
    expect(derivePlatformAccessStatus({ account, now: new Date('2026-08-21T00:00:00.000Z') })).toBe('CANCELED');
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
    firstPaidAt: null,
    lastSuccessfulPaymentAt: null,
    paymentMethodStatus: 'UNKNOWN',
    paymentMethodType: null,
    paymentMethodBrand: null,
    paymentMethodLast4: null,
    paymentMethodExpMonth: null,
    paymentMethodExpYear: null,
    restrictionReason: null,
    gracePeriodStartedAt: null,
    accessStateVersion: 0,
    lastProviderEventCreatedAt: null,
    lastReconciledAt: null,
    pendingPlanCode: null,
    pendingChangeType: null,
    pendingChangeEffectiveAt: null,
    ...input,
  };
}
