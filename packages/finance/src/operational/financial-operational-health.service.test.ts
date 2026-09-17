import { describe, expect, it, vi } from 'vitest';

import {
  collectFinancialOperationalMetrics,
  hasStoredAsaasWebhookAuthTokenHash,
  listOpenFinancialOperationalAlerts,
} from './financial-operational-health.service';

describe('financial operational health queries', () => {
  it('consulta apenas a credencial de webhook da conta informada', async () => {
    const findFirst = vi.fn().mockResolvedValue({ webhookAuthTokenHash: 'hash' });

    const result = await hasStoredAsaasWebhookAuthTokenHash('conta-a', {
      asaasAccount: { findFirst },
    } as never);

    expect(result).toBe(true);
    expect(findFirst).toHaveBeenCalledWith({
      where: { financeProfile: { contaId: 'conta-a' } },
      select: { webhookAuthTokenHash: true },
    });
  });

  it('lista alertas abertos sempre filtrando pelo tenant e limitando o lote', async () => {
    const findMany = vi.fn().mockResolvedValue([]);

    await listOpenFinancialOperationalAlerts('conta-b', 999, {
      financialOperationalAlert: { findMany },
    } as never);

    expect(findMany).toHaveBeenCalledWith({
      where: { contaId: 'conta-b', status: 'OPEN' },
      orderBy: [{ severity: 'asc' }, { lastSeenAt: 'desc' }],
      take: 100,
    });
  });

  it('consolida a coleta de métricas em uma consulta tenant-scoped', async () => {
    const $queryRaw = vi.fn().mockResolvedValue([
      {
        webhookBacklog: 2n,
        staleWebhooks: 1n,
        failedWebhooks: 0n,
        notificationBacklog: 3n,
        failedNotifications: 0n,
        notificationSyncBacklog: 1n,
        failedNotificationSyncs: 0n,
        failedJobs: 0n,
        staleJobs: 0n,
        customerWithAsaas: 4n,
        customerSnapshots: 4n,
        billingReadModelLag: 0n,
        transactionCount: 1n,
        freshDailyAggregates: 1n,
      },
    ]);

    const metrics = await collectFinancialOperationalMetrics('conta-c', { $queryRaw } as never);

    expect($queryRaw).toHaveBeenCalledTimes(1);
    expect(metrics).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'webhook_backlog', value: 2 }),
      expect.objectContaining({ key: 'notification_outbox_backlog', value: 3 }),
      expect.objectContaining({ key: 'customer_snapshot_missing', value: 0 }),
      expect.objectContaining({ key: 'finance_aggregate_missing', value: 0 }),
    ]));
  });
});
