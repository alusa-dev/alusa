/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ notify: vi.fn(), listContas: vi.fn(), scope: vi.fn(), log: vi.fn() }));
vi.mock('@alusa/lib/jobs/notify-contracts-expiring', () => ({
  notifyContractsExpiring: mocks.notify,
  listContasForContractExpiration: mocks.listContas,
}));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope: mocks.scope }));
vi.mock('@/src/server/jobs/job-observability', () => ({
  resolveTenantScopeForJob: (_name: string, resolve: () => unknown) => resolve(),
  startJobRun: vi.fn(() => ({ startedAt: Date.now(), correlationId: 'test-run-id' })), logJobResult: mocks.log, logJobFailure: vi.fn() }));

import { POST } from '../route';

describe('notify-contracts-expiring work classification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scope.mockResolvedValue({ ok: true, isCron: true, contaId: 'conta-a' });
    mocks.notify.mockResolvedValue({ evaluated: 0, notified: 0 });
    mocks.listContas.mockResolvedValue([]);
  });

  it('does not treat every evaluated contract as an expiring-alert effect', async () => {
    mocks.notify.mockResolvedValue({ evaluated: 4, notified: 0 });
    await POST(new Request('http://localhost/api/jobs/notify-contracts-expiring', { method: 'POST' }));
    expect(mocks.log).toHaveBeenLastCalledWith('notify-contracts-expiring', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.objectContaining({ evaluated: 4, notified: 0 }), expect.objectContaining({ workStatus: 'unknown' }));

    mocks.notify.mockResolvedValue({ evaluated: 1, notified: 1 });
    await POST(new Request('http://localhost/api/jobs/notify-contracts-expiring', { method: 'POST' }));
    expect(mocks.log).toHaveBeenLastCalledWith('notify-contracts-expiring', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.any(Object), expect.objectContaining({ workStatus: 'worked' }));

    mocks.notify.mockResolvedValue({ evaluated: 0, notified: 0 });
    await POST(new Request('http://localhost/api/jobs/notify-contracts-expiring', { method: 'POST' }));
    expect(mocks.log).toHaveBeenLastCalledWith('notify-contracts-expiring', expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }), expect.any(Object), expect.objectContaining({ workStatus: 'empty' }));
  });
});
