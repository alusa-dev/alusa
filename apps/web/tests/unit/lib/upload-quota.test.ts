import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reservationFindFirst, reservationUpdateMany, quotaUpdate } = vi.hoisted(() => ({
  reservationFindFirst: vi.fn(),
  reservationUpdateMany: vi.fn(),
  quotaUpdate: vi.fn(),
}));

vi.mock('@/lib/prisma-tenant', () => ({
  runWithTenant: (_contaId: string, callback: (tx: unknown) => unknown) => callback({
    tenantUploadReservation: {
      findFirst: reservationFindFirst,
      updateMany: reservationUpdateMany,
    },
    tenantUploadQuota: { update: quotaUpdate },
  }),
}));
vi.mock('server-only', () => ({}));

import { getTenantUploadReservation, releaseTenantUpload } from '@/lib/upload-quota.server';

describe('upload quota tenant isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reservationFindFirst.mockResolvedValue(null);
  });

  it('does not find a reservation from another tenant', async () => {
    await expect(getTenantUploadReservation('conta-a', 'reservation-b')).resolves.toBeNull();
    expect(reservationFindFirst).toHaveBeenCalledWith({
      where: { id: 'reservation-b', contaId: 'conta-a' },
    });
  });

  it('does not release quota when the reservation is outside the tenant scope', async () => {
    await expect(releaseTenantUpload('conta-a', 'reservation-b')).resolves.toBe(false);
    expect(reservationFindFirst).toHaveBeenCalledWith({
      where: { id: 'reservation-b', contaId: 'conta-a', status: 'PENDING' },
    });
    expect(reservationUpdateMany).not.toHaveBeenCalled();
    expect(quotaUpdate).not.toHaveBeenCalled();
  });
});
