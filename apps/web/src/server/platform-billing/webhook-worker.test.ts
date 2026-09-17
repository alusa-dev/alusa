import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    platformBillingWebhookEvent: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    platformBillingAuditLog: {
      create: vi.fn(),
    },
    $executeRaw: vi.fn(),
  },
}));

vi.mock('@alusa/database', () => ({ prisma: prismaMock }));
vi.mock('@alusa/platform-billing', () => ({
  PlatformBillingError: class PlatformBillingError extends Error {},
  classifyPlatformBillingWebhookError: vi.fn(),
  computePlatformBillingWebhookNextAttemptAt: vi.fn(),
  createPrismaPlatformBillingStore: vi.fn(),
  hasExhaustedPlatformBillingWebhookAttempts: vi.fn(),
  processPersistedPlatformBillingWebhookEvent: vi.fn(),
}));
vi.mock('./platform-billing-server', () => ({
  resolvePlatformBillingEnvironment: () => 'TEST',
}));
vi.mock('./platform-billing-notifications', () => ({
  notifyPlatformBillingEvent: vi.fn(),
}));

import { listStripeWebhookEvents, replayStripeWebhookEvents } from './webhook-worker';

describe('platform billing webhook worker persistence boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.platformBillingWebhookEvent.findMany.mockResolvedValue([]);
    prismaMock.platformBillingWebhookEvent.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.platformBillingAuditLog.create.mockResolvedValue({ id: 'audit-1' });
  });

  it('lista apenas eventos do tenant autenticado', async () => {
    await listStripeWebhookEvents({
      contaId: 'conta-a',
      environment: 'TEST',
      status: ['FAILED', 'EXHAUSTED'],
      limit: 25,
    });

    expect(prismaMock.platformBillingWebhookEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        contaId: 'conta-a',
        environment: 'TEST',
        status: { in: ['FAILED', 'EXHAUSTED'] },
      },
      take: 25,
    }));
  });

  it('restringe replay ao tenant e preserva auditoria da operação', async () => {
    prismaMock.platformBillingWebhookEvent.findMany.mockResolvedValue([
      { id: 'event-a', contaId: 'conta-a', eventId: 'stripe-event-a', eventType: 'invoice.paid' },
    ]);

    await replayStripeWebhookEvents({
      ids: ['event-a', 'event-b'],
      contaId: 'conta-a',
      actorUserId: 'user-a',
      reason: 'Retry operacional autorizado',
      environment: 'TEST',
    });

    expect(prismaMock.platformBillingWebhookEvent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { in: ['event-a', 'event-b'] },
        contaId: 'conta-a',
      }),
    }));
    expect(prismaMock.platformBillingAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        contaId: 'conta-a',
        actorUserId: 'user-a',
        action: 'PLATFORM_BILLING_WEBHOOK_REPLAY_REQUESTED',
      }),
    }));
  });
});
