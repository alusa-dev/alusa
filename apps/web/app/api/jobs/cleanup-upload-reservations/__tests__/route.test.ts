/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  scope: vi.fn(),
  runWithTenant: vi.fn(),
  listTenants: vi.fn(),
  deleteStorageObject: vi.fn(),
  releaseTenantUpload: vi.fn(),
  logJobResult: vi.fn(),
  logJobFailure: vi.fn(),
}));

vi.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } }));
vi.mock('@/lib/r2-storage', () => ({ deleteStorageObject: mocks.deleteStorageObject }));
vi.mock('@/lib/upload-quota.server', () => ({ releaseTenantUpload: mocks.releaseTenantUpload }));
vi.mock('@/lib/prisma-tenant', () => ({ runWithTenant: mocks.runWithTenant }));
vi.mock('@/lib/auth/tenant-scope', () => ({ resolveTenantScope: mocks.scope }));
vi.mock('@/src/server/uploads/upload-cleanup.service', () => ({ listTenantIdsForUploadCleanup: mocks.listTenants }));
vi.mock('@/src/server/jobs/job-observability', () => ({
  resolveTenantScopeForJob: (_name: string, resolve: () => unknown) => resolve(),
  startJobRun: vi.fn(() => ({ startedAt: Date.now(), correlationId: 'test-run-id' })),
  logJobResult: mocks.logJobResult,
  logJobFailure: mocks.logJobFailure,
}));

import { GET } from '../route';

describe('cleanup-upload-reservations failure telemetry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.scope.mockResolvedValue({ ok: true, contaId: 'conta-a', isCron: true });
  });

  it('logs a post-start failure once and returns a fixed error without details', async () => {
    mocks.runWithTenant.mockRejectedValue(new Error('sensitive database detail'));
    const response = await GET(new Request('http://localhost/api/jobs/cleanup-upload-reservations'));

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('sensitive database detail');
    expect(mocks.logJobFailure).toHaveBeenCalledTimes(1);
    expect(mocks.logJobFailure).toHaveBeenCalledWith(
      'cleanup-upload-reservations',
      expect.objectContaining({ correlationId: 'test-run-id' }),
      expect.any(Error),
    );
    expect(mocks.logJobResult).not.toHaveBeenCalled();
  });

  it('logs tenant discovery failures after the job has started', async () => {
    mocks.scope.mockResolvedValue({ ok: true, contaId: undefined, isCron: true });
    mocks.listTenants.mockRejectedValue(new Error('sensitive tenant query detail'));

    const response = await GET(new Request('http://localhost/api/jobs/cleanup-upload-reservations'));

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('sensitive tenant query detail');
    expect(mocks.logJobFailure).toHaveBeenCalledTimes(1);
    expect(mocks.logJobFailure).toHaveBeenCalledWith(
      'cleanup-upload-reservations',
      expect.objectContaining({ correlationId: 'test-run-id' }),
      expect.any(Error),
    );
    expect(mocks.logJobResult).not.toHaveBeenCalled();
  });
});
