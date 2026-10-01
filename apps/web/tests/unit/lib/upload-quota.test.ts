import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sharedTelemetry } from '@alusa/observability';

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
  let restoreTelemetry: (() => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    reservationFindFirst.mockResolvedValue(null);
  });

  afterEach(() => {
    restoreTelemetry?.();
    restoreTelemetry = undefined;
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

  it('records aggregate quota metrics without tenant or reservation identifiers', async () => {
    const metric = vi.fn();
    restoreTelemetry = sharedTelemetry.replaceSink({ metric });
    reservationFindFirst.mockResolvedValue({
      id: 'reservation-a',
      quotaId: 'quota-a',
      expectedSize: 100n,
    });
    reservationUpdateMany.mockResolvedValue({ count: 1 });

    await expect(releaseTenantUpload('conta-a', 'reservation-a')).resolves.toBe(true);

    expect(metric).toHaveBeenCalledWith({
      kind: 'counter',
      name: 'alusa.upload.quota.operations',
      value: 1,
      dimensions: { 'operation.name': 'released' },
    });
    expect(JSON.stringify(metric.mock.calls)).not.toContain('conta-a');
    expect(JSON.stringify(metric.mock.calls)).not.toContain('reservation-a');
  });
});
