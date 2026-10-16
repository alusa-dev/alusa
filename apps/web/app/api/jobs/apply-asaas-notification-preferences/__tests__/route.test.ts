/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  process: vi.fn(),
  scope: vi.fn(),
  log: vi.fn(),
}));

vi.mock('@alusa/finance', () => ({
  enqueueAsaasNotificationPreferenceSyncForTenant: mocks.enqueue,
  processAsaasNotificationPreferenceOutbox: mocks.process,
}));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope: mocks.scope }));
vi.mock('@/src/server/jobs/job-observability', () => ({ resolveTenantScopeForJob: (_name: string, resolve: () => unknown) => resolve(), startJobRun: vi.fn(() => ({ startedAt: Date.now(), correlationId: 'test-run-id' })), logJobResult: mocks.log, logJobFailure: vi.fn() }));

import { GET } from '../route';

describe('apply-asaas-notification-preferences work classification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scope.mockResolvedValue({ ok: true, isCron: true, contaId: undefined });
    mocks.enqueue.mockResolvedValue({ enqueued: 0, customerIds: [] });
    mocks.process.mockResolvedValue({ scanned: 0, processed: 0, updated: 0, failed: 0, exhausted: 0, errors: [] });
  });

  it('does not classify an unclaimed scan as work', async () => {
    mocks.process.mockResolvedValue({ scanned: 2, processed: 0, updated: 0, failed: 0, exhausted: 0, errors: [] });
    await GET(new Request('http://localhost/api/jobs/apply-asaas-notification-preferences'));
    expect(mocks.log).toHaveBeenLastCalledWith('apply-asaas-notification-preferences', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.objectContaining({ scanned: 2, processed: 0 }), expect.objectContaining({ workStatus: 'unknown' }));

    mocks.process.mockResolvedValue({ scanned: 1, processed: 1, updated: 1, failed: 0, exhausted: 0, errors: [] });
    await GET(new Request('http://localhost/api/jobs/apply-asaas-notification-preferences'));
    expect(mocks.log).toHaveBeenLastCalledWith('apply-asaas-notification-preferences', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.any(Object), expect.objectContaining({ workStatus: 'worked' }));

    mocks.process.mockResolvedValue({ scanned: 1, processed: 0, updated: 0, failed: 1, exhausted: 0, errors: [{ id: 'private-id' }] });
    await GET(new Request('http://localhost/api/jobs/apply-asaas-notification-preferences'));
    expect(mocks.log).toHaveBeenLastCalledWith('apply-asaas-notification-preferences', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.any(Object), expect.objectContaining({ workStatus: 'worked' }));

    mocks.process.mockResolvedValue({ scanned: 0, processed: 0, updated: 0, failed: 0, exhausted: 0, errors: [] });
    await GET(new Request('http://localhost/api/jobs/apply-asaas-notification-preferences'));
    expect(mocks.log).toHaveBeenLastCalledWith('apply-asaas-notification-preferences', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.any(Object), expect.objectContaining({ workStatus: 'empty' }));
  });

  it('includes exhausted rows in the summary and reports partial outcome', async () => {
    mocks.process.mockResolvedValue({ scanned: 2, processed: 1, updated: 1, failed: 0, exhausted: 1, errors: [] });

    const response = await GET(new Request('http://localhost/api/jobs/apply-asaas-notification-preferences'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: false, outcome: 'partial', result: { exhausted: 1 } });
    expect(mocks.log).toHaveBeenLastCalledWith(
      'apply-asaas-notification-preferences',
      expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }),
      expect.objectContaining({ exhausted: 1 }),
      expect.objectContaining({ partialFailure: true, workStatus: 'worked' }),
    );
  });
});
