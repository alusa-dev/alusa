import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  webhookCount: vi.fn(),
  rejectionCount: vi.fn(),
  webhookFindFirst: vi.fn(),
  rejectionFindFirst: vi.fn(),
  asaasAccountFindMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    webhookAsaas: {
      count: mocks.webhookCount,
      findFirst: mocks.webhookFindFirst,
    },
    webhookAsaasRejection: {
      count: mocks.rejectionCount,
      findFirst: mocks.rejectionFindFirst,
    },
    asaasAccount: {
      findMany: mocks.asaasAccountFindMany,
    },
  },
}));

import { getSupportWebhookHealth } from '@/features/support/queries/support-account';

describe('getSupportWebhookHealth', () => {
  it('raises an actionable warning when the queue or remote configuration needs attention', async () => {
    const lastReceivedAt = new Date('2026-09-03T04:58:51.000Z');
    const lastErrorAt = new Date('2026-09-03T04:58:40.000Z');
    const lastWebhookCheckAt = lastReceivedAt;

    mocks.webhookCount
      .mockResolvedValueOnce(648)
      .mockResolvedValueOnce(24)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    mocks.rejectionCount.mockResolvedValue(2);
    mocks.webhookFindFirst
      .mockResolvedValueOnce({ recebidoEm: lastReceivedAt })
      .mockResolvedValueOnce({ recebidoEm: lastErrorAt, ultimoErro: 'Token inválido' });
    mocks.rejectionFindFirst.mockResolvedValue({
      recebidoEm: new Date('2026-09-03T04:58:30.000Z'),
      reason: 'JSON inválido',
    });
    mocks.asaasAccountFindMany.mockResolvedValue([
      { webhookStatus: 'ACTIVE', lastWebhookCheckAt: lastReceivedAt },
      { webhookStatus: 'DRIFT', lastWebhookCheckAt: lastErrorAt },
    ]);

    await expect(getSupportWebhookHealth()).resolves.toMatchObject({
      status: 'WARNING',
      statusLabel: 'Atenção necessária',
      totalReceived: 648,
      processedLast24h: 24,
      pending: 2,
      errored: 1,
      rejectedLast24h: 2,
      accountsNeedingAttention: 1,
      lastReceivedAt,
      lastErrorAt,
      lastError: 'Token inválido',
      lastWebhookCheckAt,
    });
  });
});
