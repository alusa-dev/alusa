import { beforeEach, describe, expect, it, vi } from 'vitest';

const { deleteObjectMock, findManyMock, updateManyMock, releaseMock, tenantListMock } = vi.hoisted(() => ({
  deleteObjectMock: vi.fn(),
  findManyMock: vi.fn(),
  updateManyMock: vi.fn(),
  releaseMock: vi.fn(),
  tenantListMock: vi.fn(),
}));

vi.mock('@/lib/r2-storage', () => ({ deleteStorageObject: deleteObjectMock }));
vi.mock('@/lib/upload-quota.server', () => ({ releaseTenantUpload: releaseMock }));
vi.mock('@/lib/auth/tenant-scope', () => ({
  resolveTenantScope: vi.fn().mockResolvedValue({ ok: true, isCron: true }),
}));
vi.mock('@/src/server/uploads/upload-cleanup.service', () => ({ listTenantIdsForUploadCleanup: tenantListMock }));
vi.mock('@/lib/prisma-tenant', () => ({
  runWithTenant: (_contaId: string, callback: (tx: unknown) => unknown) => callback({
    tenantUploadReservation: { findMany: findManyMock, updateMany: updateManyMock },
  }),
}));

import { GET } from '@/app/api/jobs/cleanup-upload-reservations/route';

describe('GET /api/jobs/cleanup-upload-reservations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });
});
