/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reconcileFinanceWebhooksJob, resolveTenantScope, startJobRun, logJobResult } = vi.hoisted(() => ({
  reconcileFinanceWebhooksJob: vi.fn(),
  resolveTenantScope: vi.fn(),
  startJobRun: vi.fn(() => ({ startedAt: Date.now(), correlationId: 'test-run-id' })),
  logJobResult: vi.fn(),
}));
vi.mock('@alusa/finance', () => ({ reconcileFinanceWebhooksJob, syncPaymentStateFromAsaas: vi.fn() }));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope }));
vi.mock('@/src/server/jobs/job-observability', () => ({
  resolveTenantScopeForJob: (_name: string, resolve: () => unknown) => resolve(),
  startJobRun, logJobResult, logJobFailure: vi.fn(),
}));

import { POST } from '../route';

function jobResult({ outcome = 'completed', budgetExhausted = false, calls = [80, 90] } = {}) {
  return {
    outcome,
    budgetExhausted,
    skippedDueToLock: false,
    results: calls.map((asaasCalls) => ({
      contaId: 'sensitive-tenant-id',
      reconcile: { asaasCalls, checkedPayments: 1, checkedSubscriptions: 0, checkedInstallments: 0 },
      gaps: null,
    })),
  };
}

describe('POST /api/jobs/reconcile-finance-webhooks budget telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantScope.mockResolvedValue({ ok: true, contaId: undefined, isCron: true });
    reconcileFinanceWebhooksJob.mockResolvedValue(jobResult());
  });

  it('registra somente agregados por orçamento e marca pressão a partir de 80%', async () => {
    const response = await POST(new Request('http://localhost/api/jobs/reconcile-finance-webhooks', { method: 'POST' }));
    expect(response.status).toBe(200);
    expect(logJobResult).toHaveBeenCalledWith('reconcile-finance-webhooks', expect.any(Object), expect.any(Object), expect.objectContaining({
      maxAsaasCallsPerAccount: 90,
      accountsNearAsaasCallBudget: 2,
      accountsAtAsaasCallBudget: 0,
      maxAsaasCallBudgetUtilizationPercent: 90,
      attentionRequired: true,
      partialFailure: false,
    }));
    expect(JSON.stringify(logJobResult.mock.calls[0]?.[3])).not.toContain('sensitive-tenant-id');
  });

  it('marca orçamento esgotado como falha parcial', async () => {
    reconcileFinanceWebhooksJob.mockResolvedValue(jobResult({ outcome: 'partial', budgetExhausted: true, calls: [100] }));
    const response = await POST(new Request('http://localhost/api/jobs/reconcile-finance-webhooks', { method: 'POST' }));
    expect(response.status).toBe(207);
    expect(logJobResult).toHaveBeenCalledWith('reconcile-finance-webhooks', expect.any(Object), expect.any(Object), expect.objectContaining({
      accountsAtAsaasCallBudget: 1,
      maxAsaasCallBudgetUtilizationPercent: 100,
      budgetExhausted: true,
      partialFailure: true,
      attentionRequired: true,
    }));
  });
});
