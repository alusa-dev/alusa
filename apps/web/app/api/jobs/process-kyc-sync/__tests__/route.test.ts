/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { processKycReadModelSyncJobs, resolveTenantScope, resolveTenantScopeForJob, startJobRun, logJobResult, logJobFailure } = vi.hoisted(() => ({
  processKycReadModelSyncJobs: vi.fn(),
  resolveTenantScope: vi.fn(),
  resolveTenantScopeForJob: vi.fn((_name: string, resolve: () => unknown) => resolve()),
  startJobRun: vi.fn(() => ({ startedAt: Date.now(), correlationId: 'test-run-id' })),
  logJobResult: vi.fn(),
  logJobFailure: vi.fn(),
}));
vi.mock('@alusa/finance', () => ({ processKycReadModelSyncJobs }));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope }));
vi.mock('@/src/server/jobs/job-observability', () => ({ resolveTenantScopeForJob, startJobRun, logJobResult, logJobFailure }));

import { POST } from '../route';

describe('POST /api/jobs/process-kyc-sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveTenantScopeForJob.mockImplementation((_name: string, resolve: () => unknown) => resolve());
  });

  it('registra rejeição de auth sem iniciar job ou processar fila', async () => {
    const response = new Response(null, { status: 401 });
    resolveTenantScope.mockResolvedValue({ ok: false, response });
    await expect(POST(new Request('http://localhost/api/jobs/process-kyc-sync', { method: 'POST' }))).resolves.toBe(response);
    expect(resolveTenantScopeForJob).toHaveBeenCalledWith('process-kyc-sync', expect.any(Function));
    expect(startJobRun).not.toHaveBeenCalled();
    expect(processKycReadModelSyncJobs).not.toHaveBeenCalled();
  });

  it('limita o processamento a 10 e classifica fila vazia', async () => {
    resolveTenantScope.mockResolvedValue({ ok: true, contaId: undefined });
    processKycReadModelSyncJobs.mockResolvedValue({ processed: 0, failed: 0 });
    const response = await POST(new Request('http://localhost/api/jobs/process-kyc-sync', { method: 'POST' }));
    expect(response.status).toBe(200);
    expect(processKycReadModelSyncJobs).toHaveBeenCalledWith({ contaId: undefined, limit: 10 });
    expect(logJobResult).toHaveBeenCalledWith('process-kyc-sync', expect.any(Object), { processed: 0, failed: 0 }, expect.objectContaining({ workStatus: 'empty' }));
  });
});
