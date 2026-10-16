/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reconcileKycModels, resolveTenantScope, logJobResult } = vi.hoisted(() => ({
  reconcileKycModels: vi.fn(),
  resolveTenantScope: vi.fn(),
  logJobResult: vi.fn(),
}));
vi.mock('@alusa/finance', () => ({ reconcileKycModels }));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope }));
vi.mock('@/src/server/jobs/job-observability', () => ({
  resolveTenantScopeForJob: (_name: string, resolve: () => unknown) => resolve(),
  startJobRun: vi.fn(() => ({ startedAt: Date.now(), correlationId: 'test-run-id' })), logJobResult, logJobFailure: vi.fn() }));

import { GET } from '../route';

describe('GET /api/jobs/reconcile-kyc-models', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantScope.mockResolvedValue({ ok: true, contaId: undefined, isCron: true });
  });

  it('does not treat account enumeration as work and preserves unknown on a capped batch', async () => {
    reconcileKycModels.mockResolvedValue({ checkedAccounts: 100, inconsistenciesFound: 0, reconciled: 0, errors: [], details: [] });
    await GET(new Request('http://localhost/api/jobs/reconcile-kyc-models'));
    expect(logJobResult).toHaveBeenCalledWith('reconcile-kyc-models', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.any(Object), expect.objectContaining({ workStatus: 'unknown' }));
  });

  it('classifies detected inconsistencies as work and an uncapped clean batch as empty', async () => {
    reconcileKycModels.mockResolvedValue({ checkedAccounts: 1, inconsistenciesFound: 1, reconciled: 0, errors: [], details: [] });
    await GET(new Request('http://localhost/api/jobs/reconcile-kyc-models'));
    expect(logJobResult).toHaveBeenLastCalledWith('reconcile-kyc-models', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.any(Object), expect.objectContaining({ workStatus: 'worked' }));
    reconcileKycModels.mockResolvedValue({ checkedAccounts: 1, inconsistenciesFound: 0, reconciled: 0, errors: [], details: [] });
    await GET(new Request('http://localhost/api/jobs/reconcile-kyc-models'));
    expect(logJobResult).toHaveBeenLastCalledWith('reconcile-kyc-models', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.any(Object), expect.objectContaining({ workStatus: 'empty' }));
  });
});
