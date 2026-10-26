import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationSeverity } from '@prisma/client';

const { createNotificationMock, sendEmailMock, usersFindManyMock, billingAccountFindFirstMock, tenantTx, runWithTenantMock } = vi.hoisted(() => {
  const tenantTx = {
    $queryRaw: vi.fn(),
    platformBillingAccount: { findFirst: vi.fn() },
  };
  return {
    createNotificationMock: vi.fn(),
    sendEmailMock: vi.fn(),
    usersFindManyMock: vi.fn(),
    billingAccountFindFirstMock: vi.fn(),
    tenantTx,
    runWithTenantMock: vi.fn(async (_contaId: string, callback: (tx: unknown) => Promise<unknown>) => callback(tenantTx)),
  };
});

vi.mock('@alusa/lib/services/notifications.service', () => ({ createNotification: createNotificationMock }));
vi.mock('@/lib/email/transactional-email', () => ({ sendTransactionalEmail: sendEmailMock }));
vi.mock('@/lib/prisma', () => ({ default: {
  usuarioConta: { findMany: usersFindManyMock },
  platformBillingAccount: { findFirst: billingAccountFindFirstMock },
} }));
vi.mock('@/lib/app-url', () => ({ buildAppUrl: (path: string) => `https://alusa.test${path}` }));
vi.mock('@/lib/observability/api-logger', () => ({ logApiOperationalEvent: vi.fn() }));
vi.mock('@/lib/prisma-tenant', () => ({ runWithTenant: runWithTenantMock }));

import { notifyPlatformBillingEvent } from './platform-billing-notifications';

describe('platform billing notification wording', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createNotificationMock.mockResolvedValue(undefined);
    sendEmailMock.mockResolvedValue(undefined);
    usersFindManyMock.mockResolvedValue([{ usuario: { id: 'user-a', nome: 'Admin', email: 'admin@example.test' } }]);
    billingAccountFindFirstMock.mockResolvedValue({
      planCode: 'BAND_151_200',
      trialEndsAt: new Date('2030-01-15T00:00:00.000Z'),
    });
    tenantTx.$queryRaw.mockResolvedValue([{ id: 'billing-a' }]);
    tenantTx.platformBillingAccount.findFirst.mockResolvedValue({
      id: 'billing-a',
      planCode: 'BAND_151_200',
      trialEndsAt: new Date('2030-01-01T00:00:00.000Z'),
      stripeSubscriptionId: 'sub-a',
    });
  });

  it.each([
    ['checkout.session.completed', /checkout da assinatura concluído/i, /registrou a conclusão do checkout/i],
    ['customer.subscription.created', /assinatura criada/i, /registrou uma assinatura/i],
    ['invoice.paid', /pagamento de fatura confirmado/i, /pagamento de uma fatura/i],
    ['invoice.payment_failed', /pagamento da assinatura pendente/i, /sinalizou falha ou ação necessária/i],
  ])('%s reports only what the Stripe event establishes', async (eventType, expectedTitle, expectedMessage) => {
    await notifyPlatformBillingEvent({ contaId: 'conta-a', eventId: `evt-${eventType}`, eventType });

    const notification = createNotificationMock.mock.calls[0]?.[0];
    expect(notification.title).toMatch(expectedTitle);
    expect(notification.message).toMatch(expectedMessage);
    if (eventType === 'customer.subscription.created') expect(notification.severity).toBe(NotificationSeverity.INFO);
    expect(notification.title).not.toMatch(/pagamento da assinatura concluído|está ativa|regularizada/i);
    expect(notification.message).not.toMatch(/pagamento da assinatura concluído|está ativa|foi regularizada/i);
    for (const email of sendEmailMock.mock.calls) {
      expect(email[0].subject).not.toMatch(/está ativa|regularizada/i);
      expect(email[0].html).not.toMatch(/está ativa|foi regularizada/i);
    }
  });

  it('includes the trial end date and current price band in the three-day reminder', async () => {
    await notifyPlatformBillingEvent({
      contaId: 'conta-a',
      eventId: 'evt-trial-will-end',
      eventType: 'customer.subscription.trial_will_end',
      environment: 'TEST',
    });

    const notification = createNotificationMock.mock.calls[0]?.[0];
    expect(notification.message).toMatch(/14 de janeiro de 2030/);
    expect(notification.message).toMatch(/151–200 alunos/);
    expect(notification.message).toMatch(/R\$\s?419,00\/mês/);
    expect(notification.message).toMatch(/sem confirmação, não haverá cobrança/i);
    expect(sendEmailMock.mock.calls[0]?.[0].html).toMatch(/R\$\s?419,00\/mês/);
  });

  it('suppresses queued trial-expired notice when payment lands before notification delivery', async () => {
    tenantTx.platformBillingAccount.findFirst.mockResolvedValueOnce(null);

    await notifyPlatformBillingEvent({
      contaId: 'conta-a',
      eventId: 'trial-expired:billing-a',
      eventType: 'platform.billing_trial_expired',
      environment: 'TEST',
    });

    expect(runWithTenantMock).toHaveBeenCalledWith('conta-a', expect.any(Function));
    expect(tenantTx.$queryRaw).toHaveBeenCalledOnce();
    expect(tenantTx.platformBillingAccount.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'billing-a', contaId: 'conta-a', environment: 'TEST', firstPaidAt: null, lastSuccessfulPaymentAt: null }),
    }));
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it('delivers trial-expired notice while holding the unpaid billing row lock', async () => {
    await notifyPlatformBillingEvent({
      contaId: 'conta-a',
      eventId: 'trial-expired:billing-a',
      eventType: 'platform.billing_trial_expired',
      environment: 'TEST',
    });

    expect(tenantTx.$queryRaw).toHaveBeenCalledOnce();
    expect(createNotificationMock).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-a',
      dedupeKey: 'platform-billing:trial-expired:billing-a',
    }));
  });
});
