import { describe, expect, it, vi } from 'vitest';

import {
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
});
