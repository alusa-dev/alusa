import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@alusa/database', () => ({
  prisma: {
    asaasIntegrationJob: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../sync-payment-state-from-asaas', () => ({
  syncPaymentStateFromAsaas: vi.fn(),
}));

vi.mock('../payment-command-ledger', () => ({
  markStalePaymentCommandsForReconciliation: vi.fn(async () => ({ processed: 0, marked: 0 })),
}));

import { prisma } from '@alusa/database';
import { markStalePaymentCommandsForReconciliation } from '../payment-command-ledger';
import { syncPaymentStateFromAsaas } from '../sync-payment-state-from-asaas';
import { reconcilePendingPaymentCommands } from '../reconcile-pending-payment-commands';

describe('reconcilePendingPaymentCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sincroniza comandos pendentes usando contaId do próprio job', async () => {
    vi.mocked(prisma.asaasIntegrationJob.findMany).mockResolvedValueOnce([
      {
        id: 'job-1',
        contaId: 'conta-1',
        payload: {
          asaasPaymentId: 'pay-1',
          expectedEvents: ['PAYMENT_DELETED'],
        },
      },
      {
        id: 'job-2',
        contaId: 'conta-2',
        payload: {
          asaasPaymentId: 'pay-2',
          expectedEvents: ['PAYMENT_REFUNDED'],
        },
      },
    ] as never);
    vi.mocked(syncPaymentStateFromAsaas).mockResolvedValue({
      success: true,
      asaasPaymentId: 'pay-any',
      paymentStatus: 'PENDING',
      appliedEvent: 'PAYMENT_UPDATED',
      invoiceUrl: null,
      bankSlipUrl: null,
      transactionReceiptUrl: null,
    });

    const result = await reconcilePendingPaymentCommands({
      limit: 25,
      pollOlderThanSeconds: 30,
      staleOlderThanMinutes: 10,
    });

    expect(result).toEqual({
      scanned: 2,
      synced: 2,
      syncFailed: 0,
      stale: { processed: 0, marked: 0 },
    });
    expect(syncPaymentStateFromAsaas).toHaveBeenCalledWith({
      contaId: 'conta-1',
      asaasPaymentId: 'pay-1',
    });
    expect(syncPaymentStateFromAsaas).toHaveBeenCalledWith({
      contaId: 'conta-2',
      asaasPaymentId: 'pay-2',
    });
  });

  it('restringe por contaId quando informado e contabiliza falhas de sync', async () => {
    vi.mocked(prisma.asaasIntegrationJob.findMany).mockResolvedValueOnce([
      {
        id: 'job-1',
        contaId: 'conta-1',
        payload: { asaasPaymentId: 'pay-1' },
      },
    ] as never);
    vi.mocked(syncPaymentStateFromAsaas).mockResolvedValueOnce({
      success: false,
      error: 'SYNC_FAILED',
    });
    vi.mocked(markStalePaymentCommandsForReconciliation).mockResolvedValueOnce({
      processed: 1,
      marked: 1,
    });

    const result = await reconcilePendingPaymentCommands({ contaId: 'conta-1' });

    expect(prisma.asaasIntegrationJob.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ contaId: 'conta-1' }),
    }));
    expect(result).toMatchObject({
      scanned: 1,
      synced: 0,
      syncFailed: 1,
      stale: { processed: 1, marked: 1 },
    });
    expect(markStalePaymentCommandsForReconciliation).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-1',
    }));
  });
});
