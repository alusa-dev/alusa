import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  windowFindFirst: vi.fn(),
  snapshotFindMany: vi.fn(),
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    financialTransactionSyncWindow: { findFirst: mocks.windowFindFirst },
    financialTransactionSnapshot: { findMany: mocks.snapshotFindMany },
  },
}));

import { readConfirmedAsaasLedgerFee } from './confirmed-asaas-ledger-fee';

describe('readConfirmedAsaasLedgerFee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.windowFindFirst.mockResolvedValue({ truncated: false, fetchedCount: 10, officialTotalCount: 10 });
    mocks.snapshotFindMany.mockResolvedValue([
      { type: 'PAYMENT_FEE', value: 3.25 },
      { type: 'PAYMENT_FEE_REVERSAL', value: 0.25 },
    ]);
  });

  it('reads fee rows only from a recent complete tenant snapshot', async () => {
    const fee = await readConfirmedAsaasLedgerFee('conta-a', 'pay-a', new Date());

    expect(fee).toBe(3);
    expect(mocks.windowFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'conta-a', windowKey: expect.any(String), syncedAt: expect.objectContaining({ gte: expect.any(Date) }) }),
    }));
    expect(mocks.snapshotFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'conta-a', paymentId: 'pay-a' }),
    }));
  });

  it('returns unknown when the local window is incomplete', async () => {
    mocks.windowFindFirst.mockResolvedValue({ truncated: true, fetchedCount: 1, officialTotalCount: 2 });

    await expect(readConfirmedAsaasLedgerFee('conta-a', 'pay-a', new Date())).resolves.toBeNull();

    expect(mocks.snapshotFindMany).not.toHaveBeenCalled();
  });
});
