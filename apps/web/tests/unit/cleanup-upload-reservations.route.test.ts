import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  deleteObjectMock,
  findManyMock,
  updateManyMock,
  releaseMock,
  tenantListMock,
  resolveScopeMock,
  resolveTenantScopeForJobMock,
  startJobRunMock,
  logJobResultMock,
} = vi.hoisted(() => ({
  deleteObjectMock: vi.fn(),
  findManyMock: vi.fn(),
  updateManyMock: vi.fn(),
  releaseMock: vi.fn(),
  tenantListMock: vi.fn(),
  resolveScopeMock: vi.fn(),
  resolveTenantScopeForJobMock: vi.fn(),
  startJobRunMock: vi.fn(() => ({ startedAt: Date.now(), correlationId: 'test-run-id' })),
  logJobResultMock: vi.fn(),
}));

vi.mock('@/lib/r2-storage', () => ({ deleteStorageObject: deleteObjectMock }));
vi.mock('@/lib/upload-quota.server', () => ({ releaseTenantUpload: releaseMock }));
vi.mock('@/lib/auth/tenant-scope', () => ({
  resolveTenantScope: resolveScopeMock,
}));
vi.mock('@/src/server/uploads/upload-cleanup.service', () => ({ listTenantIdsForUploadCleanup: tenantListMock }));
vi.mock('@/src/server/jobs/job-observability', () => ({
  resolveTenantScopeForJob: resolveTenantScopeForJobMock,
  startJobRun: startJobRunMock,
  logJobResult: logJobResultMock,
}));
vi.mock('@/lib/prisma-tenant', () => ({
  runWithTenant: (_contaId: string, callback: (_tx: unknown) => unknown) => callback({
    tenantUploadReservation: { findMany: findManyMock, updateMany: updateManyMock },
  }),
}));

import { GET } from '@/app/api/jobs/cleanup-upload-reservations/route';

describe('GET /api/jobs/cleanup-upload-reservations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveScopeMock.mockResolvedValue({ ok: true, isCron: true, contaId: 'conta-1' });
    resolveTenantScopeForJobMock.mockImplementation(async (_jobName: string, resolve: () => Promise<unknown>) => resolve());
    tenantListMock.mockResolvedValue([{ id: 'conta-1' }]);
    findManyMock.mockResolvedValue([
      { id: 'pending-1', contaId: 'conta-1', objectKey: 'uploads/pending/conta-1/pending-1', status: 'PENDING', finalObjectKey: null },
      { id: 'inline-1', contaId: 'conta-1', objectKey: 'uploads/avatars/conta-1/user-1/avatar.jpg', status: 'COMPLETED', finalObjectKey: null },
    ]);
    deleteObjectMock.mockResolvedValue(undefined);
    releaseMock.mockResolvedValue(true);
    updateManyMock.mockResolvedValue({ count: 1 });
  });

  it('deletes expired staging objects without deleting completed inline assets', async () => {
    const response = await GET(new Request('https://alusa.app/api/jobs/cleanup-upload-reservations', {
      headers: { authorization: 'Bearer cron-test' },
    }));

    expect(response.status).toBe(200);
    expect(deleteObjectMock).toHaveBeenCalledWith('uploads/pending/conta-1/pending-1');
    expect(deleteObjectMock).toHaveBeenCalledWith('uploads/confirmed/conta-1/pending-1');
    expect(deleteObjectMock).not.toHaveBeenCalledWith('uploads/avatars/conta-1/user-1/avatar.jpg');
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          expect.objectContaining({ status: 'COMPLETED', finalObjectKey: { not: null }, pendingCleanedAt: null }),
        ]),
      }),
    }));
    expect(updateManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'inline-1', contaId: 'conta-1', status: 'COMPLETED', pendingCleanedAt: null },
    }));
    expect(logJobResultMock).toHaveBeenCalledWith('cleanup-upload-reservations', expect.objectContaining({ startedAt: expect.any(Number), correlationId: 'test-run-id' }), expect.objectContaining({ storageObjectsDeleted: 2, reservationsUpdated: 2 }), expect.objectContaining({ workStatus: 'worked' }));
  });

  it('classifies scan-only reservations as unknown and a confirmed empty query as empty', async () => {
    findManyMock.mockResolvedValue([
      { id: 'completed-1', contaId: 'conta-1', objectKey: 'uploads/avatars/a.png', status: 'COMPLETED', finalObjectKey: null },
    ]);
    updateManyMock.mockResolvedValue({ count: 0 });
    await GET(new Request('https://alusa.app/api/jobs/cleanup-upload-reservations'));
    expect(logJobResultMock).toHaveBeenCalledWith('cleanup-upload-reservations', expect.objectContaining({ startedAt: expect.any(Number), correlationId: 'test-run-id' }), expect.objectContaining({ processed: 1 }), expect.objectContaining({ workStatus: 'unknown' }));

    logJobResultMock.mockClear();
    findManyMock.mockResolvedValue([]);
    await GET(new Request('https://alusa.app/api/jobs/cleanup-upload-reservations'));
    expect(logJobResultMock).toHaveBeenCalledWith('cleanup-upload-reservations', expect.objectContaining({ startedAt: expect.any(Number), correlationId: 'test-run-id' }), expect.objectContaining({ processed: 0 }), expect.objectContaining({ workStatus: 'empty' }));
  });

  it('records scope rejection before starting the cleanup job', async () => {
    resolveScopeMock.mockResolvedValueOnce({
      ok: false,
      response: new Response('forbidden', { status: 403 }),
    });

    const response = await GET(new Request('https://alusa.app/api/jobs/cleanup-upload-reservations'));

    expect(response.status).toBe(403);
    expect(resolveTenantScopeForJobMock).toHaveBeenCalledWith('cleanup-upload-reservations', expect.any(Function));
    expect(startJobRunMock).not.toHaveBeenCalled();
    expect(tenantListMock).not.toHaveBeenCalled();
    expect(findManyMock).not.toHaveBeenCalled();
  });
});
