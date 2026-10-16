/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reconcileAsaasAccountsJob, resolveTenantScope, logJobResult } = vi.hoisted(() => ({
  reconcileAsaasAccountsJob: vi.fn(),
  resolveTenantScope: vi.fn(),
  logJobResult: vi.fn(),
}));
vi.mock('@alusa/finance', () => ({ reconcileAsaasAccountsJob }));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope }));
vi.mock('@/src/server/jobs/job-observability', () => ({
  resolveTenantScopeForJob: (_name: string, resolve: () => unknown) => resolve(),
  startJobRun: vi.fn(() => ({ startedAt: Date.now(), correlationId: 'test-run-id' })), logJobResult, logJobFailure: vi.fn() }));

import { POST } from '../route';

describe('POST /api/jobs/reconcile-finance-accounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantScope.mockResolvedValue({ ok: true, contaId: undefined, isCron: true });
  });

  it('marks only successful reconciliations as work and leaves throttled candidates unknown', async () => {
    reconcileAsaasAccountsJob.mockResolvedValue({ processadas: 2, reconciliadas: 1, skippedThrottle: 0, erros: [] });
    await POST(new Request('http://localhost/api/jobs/reconcile-finance-accounts', { method: 'POST' }));
    expect(logJobResult).toHaveBeenCalledWith('reconcile-finance-accounts', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.any(Object), expect.objectContaining({ workStatus: 'worked' }));
    reconcileAsaasAccountsJob.mockResolvedValue({ processadas: 1, reconciliadas: 0, skippedThrottle: 1, erros: [] });
    await POST(new Request('http://localhost/api/jobs/reconcile-finance-accounts', { method: 'POST' }));
    expect(logJobResult).toHaveBeenLastCalledWith('reconcile-finance-accounts', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.any(Object), expect.objectContaining({ workStatus: 'unknown' }));
    reconcileAsaasAccountsJob.mockResolvedValue({ processadas: 0, reconciliadas: 0, skippedThrottle: 0, erros: [] });
    await POST(new Request('http://localhost/api/jobs/reconcile-finance-accounts', { method: 'POST' }));
    expect(logJobResult).toHaveBeenLastCalledWith('reconcile-finance-accounts', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.any(Object), expect.objectContaining({ workStatus: 'empty' }));
  });
});
