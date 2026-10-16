/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ process: vi.fn(), scope: vi.fn(), log: vi.fn() }));

vi.mock('@alusa/finance', () => ({ processAsaasProvisioningJobs: mocks.process }));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope: mocks.scope }));
vi.mock('@/src/server/jobs/job-observability', () => ({
  resolveTenantScopeForJob: (_name: string, resolve: () => unknown) => resolve(),
  startJobRun: vi.fn(() => ({ startedAt: Date.now(), correlationId: 'test-run-id' })), logJobResult: mocks.log, logJobFailure: vi.fn() }));

import { GET } from '../route';

describe('provision-asaas-subaccounts work classification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scope.mockResolvedValue({ ok: true, isCron: true, contaId: undefined });
    mocks.process.mockResolvedValue({ processed: 0, succeeded: 0, failed: 0, recoveryRequired: 0, webhookJobsQueued: 0 });
  });

  it('classifies no-op runs as empty but leaves failed or recovery work unknown', async () => {
    await GET(new Request('http://localhost/api/jobs/provision-asaas-subaccounts'));
    expect(mocks.log).toHaveBeenLastCalledWith(
      'provision-asaas-subaccounts',
      expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }),
      expect.any(Object),
      expect.objectContaining({ workStatus: 'empty', partialFailure: false }),
    );

    mocks.process.mockResolvedValue({ processed: 0, succeeded: 0, failed: 1, recoveryRequired: 0, webhookJobsQueued: 0 });
    await GET(new Request('http://localhost/api/jobs/provision-asaas-subaccounts'));
    expect(mocks.log).toHaveBeenLastCalledWith(
      'provision-asaas-subaccounts',
      expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }),
      expect.any(Object),
      expect.objectContaining({ workStatus: 'unknown', partialFailure: true }),
    );

    mocks.process.mockResolvedValue({ processed: 0, succeeded: 0, failed: 0, recoveryRequired: 1, webhookJobsQueued: 0 });
    await GET(new Request('http://localhost/api/jobs/provision-asaas-subaccounts'));
    expect(mocks.log).toHaveBeenLastCalledWith(
      'provision-asaas-subaccounts',
      expect.objectContaining({ startedAt: expect.any(Number), correlationId: expect.any(String) }),
      expect.any(Object),
      expect.objectContaining({ workStatus: 'unknown', partialFailure: true }),
    );
  });
});
