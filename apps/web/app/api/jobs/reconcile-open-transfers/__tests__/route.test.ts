/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  reconcile: vi.fn(),
  scope: vi.fn(),
  log: vi.fn(),
}));

vi.mock('@alusa/finance', () => ({
  listAccountsWithOpenTransfers: mocks.listAccounts,
  reconcileOpenTransfers: mocks.reconcile,
}));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope: mocks.scope }));
vi.mock('@/src/server/jobs/job-observability', () => ({
  resolveTenantScopeForJob: (_name: string, resolve: () => unknown) => resolve(),
  startJobRun: vi.fn(() => ({ startedAt: Date.now(), correlationId: 'test-run-id' })), logJobResult: mocks.log, logJobFailure: vi.fn() }));

import { GET } from '../route';

describe('reconcile-open-transfers work classification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scope.mockResolvedValue({ ok: true, isCron: true, contaId: undefined });
    mocks.listAccounts.mockResolvedValue([]);
    mocks.reconcile.mockResolvedValue({ reconciled: 0, officialTransfersById: new Map() });
  });

  it('leaves accounts without confirmed transfer fetches unknown and confirms no candidates as empty', async () => {
    mocks.listAccounts.mockResolvedValue(['conta-a']);
    await GET(new Request('http://localhost/api/jobs/reconcile-open-transfers'));
    expect(mocks.log).toHaveBeenLastCalledWith('reconcile-open-transfers', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.objectContaining({ accountsProcessed: 1, fetched: 0 }), expect.objectContaining({ workStatus: 'unknown' }));

    mocks.listAccounts.mockResolvedValue([]);
    await GET(new Request('http://localhost/api/jobs/reconcile-open-transfers'));
    expect(mocks.log).toHaveBeenLastCalledWith('reconcile-open-transfers', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.objectContaining({ accountsProcessed: 0, fetched: 0 }), expect.objectContaining({ workStatus: 'empty' }));
  });
});
