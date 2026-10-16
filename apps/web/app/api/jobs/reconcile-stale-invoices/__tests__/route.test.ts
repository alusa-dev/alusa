/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ worker: vi.fn(), scope: vi.fn(), log: vi.fn() }));
vi.mock('@alusa/finance', () => ({ reconcileStaleInvoices: mocks.worker }));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope: mocks.scope }));
vi.mock('@/src/server/jobs/job-observability', () => ({
  resolveTenantScopeForJob: (_name: string, resolve: () => unknown) => resolve(),
  startJobRun: vi.fn(() => ({ startedAt: Date.now(), correlationId: 'test-run-id' })), logJobResult: mocks.log, logJobFailure: vi.fn() }));
import { GET } from '../route';
const result = (overrides = {}) => ({ scanned: 0, synced: 0, failed: 0, recovered: 0, paidChargesScanned: 0, paidChargesRecovered: 0, paidChargesFailed: 0, subscriptionSettingsScanned: 0, subscriptionSettingsSynced: 0, subscriptionSettingsFailed: 0, ...overrides });
describe('reconcile-stale-invoices telemetry', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.scope.mockResolvedValue({ ok: true, isCron: true }); mocks.worker.mockResolvedValue(result()); });
  it('uses confirmed sync/recovery counters instead of scanned candidates', async () => {
    mocks.worker.mockResolvedValue(result({ scanned: 2, synced: 0 }));
    await GET(new Request('http://localhost/api/jobs/reconcile-stale-invoices'));
    expect(mocks.log).toHaveBeenLastCalledWith('reconcile-stale-invoices', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.objectContaining({ scanned: 2 }), expect.objectContaining({ workStatus: 'unknown' }));
    mocks.worker.mockResolvedValue(result({ paidChargesScanned: 1, paidChargesRecovered: 1 }));
    await GET(new Request('http://localhost/api/jobs/reconcile-stale-invoices'));
    expect(mocks.log).toHaveBeenLastCalledWith('reconcile-stale-invoices', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.any(Object), expect.objectContaining({ workStatus: 'worked' }));
    mocks.worker.mockResolvedValue(result());
    await GET(new Request('http://localhost/api/jobs/reconcile-stale-invoices'));
    expect(mocks.log).toHaveBeenLastCalledWith('reconcile-stale-invoices', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.any(Object), expect.objectContaining({ workStatus: 'empty' }));
  });
});
