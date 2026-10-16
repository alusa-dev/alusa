/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ worker: vi.fn(), scope: vi.fn(), log: vi.fn() }));
vi.mock('@alusa/finance', () => ({ processAsaasNotificationSyncOutbox: mocks.worker }));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope: mocks.scope }));
vi.mock('@/src/server/jobs/job-observability', () => ({ resolveTenantScopeForJob: (_name: string, resolve: () => unknown) => resolve(), startJobRun: vi.fn(() => ({ startedAt: Date.now(), correlationId: 'test-run-id' })), logJobResult: mocks.log, logJobFailure: vi.fn() }));
import { GET } from '../route';
describe('process-asaas-notification-sync telemetry', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.scope.mockResolvedValue({ ok: true, isCron: true }); });
  it('does not count scans as work, but counts processed effects', async () => {
    mocks.worker.mockResolvedValue({ scanned: 3, processed: 0, partial: 0, failed: 0, exhausted: 0, errors: [] });
    await GET(new Request('http://localhost/api/jobs/process-asaas-notification-sync'));
    expect(mocks.log).toHaveBeenLastCalledWith('process-asaas-notification-sync', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.objectContaining({ scanned: 3 }), expect.objectContaining({ workStatus: 'unknown' }));
    mocks.worker.mockResolvedValue({ scanned: 1, processed: 1, partial: 0, failed: 0, exhausted: 0, errors: [] });
    await GET(new Request('http://localhost/api/jobs/process-asaas-notification-sync'));
    expect(mocks.log).toHaveBeenLastCalledWith('process-asaas-notification-sync', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.any(Object), expect.objectContaining({ workStatus: 'worked' }));
    mocks.worker.mockResolvedValue({ scanned: 1, processed: 0, partial: 0, failed: 1, exhausted: 0, errors: [{ id: 'private-id' }] });
    await GET(new Request('http://localhost/api/jobs/process-asaas-notification-sync'));
    expect(mocks.log).toHaveBeenLastCalledWith('process-asaas-notification-sync', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.any(Object), expect.objectContaining({ workStatus: 'worked' }));
    mocks.worker.mockResolvedValue({ scanned: 0, processed: 0, partial: 0, failed: 0, exhausted: 0, errors: [] });
    await GET(new Request('http://localhost/api/jobs/process-asaas-notification-sync'));
    expect(mocks.log).toHaveBeenLastCalledWith('process-asaas-notification-sync', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.any(Object), expect.objectContaining({ workStatus: 'empty' }));
  });

  it('reports exhausted rows as partial failure rather than a green result', async () => {
    mocks.worker.mockResolvedValue({ scanned: 2, processed: 1, partial: 0, failed: 0, exhausted: 1, errors: [] });

    const response = await GET(new Request('http://localhost/api/jobs/process-asaas-notification-sync'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: false, outcome: 'partial', result: { exhausted: 1 } });
    expect(mocks.log).toHaveBeenLastCalledWith(
      'process-asaas-notification-sync',
      expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }),
      expect.objectContaining({ exhausted: 1 }),
      expect.objectContaining({ partialFailure: true, workStatus: 'worked' }),
    );
  });
});
