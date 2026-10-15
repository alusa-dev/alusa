import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationSeverity } from '@prisma/client';

const { createNotificationMock, sendEmailMock, usersFindManyMock } = vi.hoisted(() => ({
  createNotificationMock: vi.fn(),
  sendEmailMock: vi.fn(),
  usersFindManyMock: vi.fn(),
}));

vi.mock('@alusa/lib/services/notifications.service', () => ({ createNotification: createNotificationMock }));
vi.mock('@/lib/email/transactional-email', () => ({ sendTransactionalEmail: sendEmailMock }));
vi.mock('@/lib/prisma', () => ({ default: { usuarioConta: { findMany: usersFindManyMock } } }));
vi.mock('@/lib/app-url', () => ({ buildAppUrl: (path: string) => `https://alusa.test${path}` }));
vi.mock('@/lib/observability/api-logger', () => ({ logApiOperationalEvent: vi.fn() }));

import { notifyPlatformBillingEvent } from './platform-billing-notifications';

describe('platform billing notification wording', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createNotificationMock.mockResolvedValue(undefined);
    sendEmailMock.mockResolvedValue(undefined);
    usersFindManyMock.mockResolvedValue([{ usuario: { id: 'user-a', nome: 'Admin', email: 'admin@example.test' } }]);
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
});
