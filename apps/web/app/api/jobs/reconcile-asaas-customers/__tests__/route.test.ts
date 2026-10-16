/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ snapshots: vi.fn(), addresses: vi.fn(), scope: vi.fn(), log: vi.fn() }));
vi.mock('@alusa/finance', () => ({ reconcileAsaasCustomerSnapshots: mocks.snapshots, reconcileResponsavelCustomerAddresses: mocks.addresses }));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope: mocks.scope }));
vi.mock('@/src/server/jobs/job-observability', () => ({
  resolveTenantScopeForJob: (_name: string, resolve: () => unknown) => resolve(),
  startJobRun: vi.fn(() => ({ startedAt: Date.now(), correlationId: 'test-run-id' })), logJobResult: mocks.log, logJobFailure: vi.fn() }));
import { GET } from '../route';
describe('reconcile-asaas-customers telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.scope.mockResolvedValue({ ok: true, isCron: true });
    mocks.snapshots.mockResolvedValue({ scanned: 0, updated: 0, deleted: 0, missingCredentials: 0, failed: 0, errors: [] });
    mocks.addresses.mockResolvedValue({ scanned: 0, synced: 0, skipped: 0, failed: 0, errors: [] });
  });
  it('counts only successful snapshot/address side effects as work', async () => {
    mocks.snapshots.mockResolvedValue({ scanned: 2, updated: 0, deleted: 0, missingCredentials: 0, failed: 0, errors: [] });
    await GET(new Request('http://localhost/api/jobs/reconcile-asaas-customers'));
    expect(mocks.log).toHaveBeenLastCalledWith('reconcile-asaas-customers', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.objectContaining({ scanned: 2 }), expect.objectContaining({ workStatus: 'unknown' }));
    mocks.addresses.mockResolvedValue({ scanned: 1, synced: 1, skipped: 0, failed: 0, errors: [] });
    await GET(new Request('http://localhost/api/jobs/reconcile-asaas-customers'));
    expect(mocks.log).toHaveBeenLastCalledWith('reconcile-asaas-customers', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.any(Object), expect.objectContaining({ workStatus: 'worked' }));
    mocks.snapshots.mockResolvedValue({ scanned: 0, updated: 0, deleted: 0, missingCredentials: 1, failed: 0, errors: [] });
    mocks.addresses.mockResolvedValue({ scanned: 0, synced: 0, skipped: 0, failed: 0, errors: [] });
    await GET(new Request('http://localhost/api/jobs/reconcile-asaas-customers'));
    expect(mocks.log).toHaveBeenLastCalledWith('reconcile-asaas-customers', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.any(Object), expect.objectContaining({ workStatus: 'unknown' }));
  });
});
