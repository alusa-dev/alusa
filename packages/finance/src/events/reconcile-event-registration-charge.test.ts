import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, txMock } = vi.hoisted(() => {
  const tx = {
    eventParticipant: { findMany: vi.fn(), updateMany: vi.fn() },
    eventBillingGroup: { findMany: vi.fn(), updateMany: vi.fn() },
    eventFinancialEntry: { findMany: vi.fn(), updateMany: vi.fn() },
  };
  return {
    txMock: tx,
    prismaMock: {
      $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
      eventParticipant: tx.eventParticipant,
    },
  };
});

vi.mock('@alusa/database', () => ({ prisma: prismaMock }));

import {
  linkReconciledEventRegistrationCharge,
  settleReconciledEventRegistrationCharge,
} from './reconcile-event-registration-charge';

describe('reconcile event registration charge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    txMock.eventParticipant.findMany.mockResolvedValue([{
      id: 'participant-1', revenueEntryId: 'entry-1', asaasPaymentId: null, asaasInstallmentId: null,
    }]);
    txMock.eventBillingGroup.findMany.mockResolvedValue([{
      id: 'group-1', asaasPaymentId: null, asaasInstallmentId: null,
    }]);
    txMock.eventFinancialEntry.findMany.mockResolvedValue([{ id: 'entry-1', asaasPaymentId: null }]);
  });

  it('religa os registros do evento pelo chargeId local e mantém a consulta tenant-scoped', async () => {
    const result = await linkReconciledEventRegistrationCharge({
      contaId: 'tenant-a',
      chargeId: 'charge-1',
      asaasPaymentId: 'pay-1',
      asaasInstallmentId: 'installment-1',
    });

    expect(result).toEqual({ linked: true, participantCount: 1 });
    expect(txMock.eventParticipant.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { contaId: 'tenant-a', standaloneChargeId: 'charge-1' },
    }));
    expect(txMock.eventBillingGroup.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { contaId: 'tenant-a', standaloneChargeId: 'charge-1' },
    }));
    expect(txMock.eventBillingGroup.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { contaId: 'tenant-a', standaloneChargeId: 'charge-1' },
      data: { asaasPaymentId: 'pay-1', asaasInstallmentId: 'installment-1' },
    }));
    expect(txMock.eventBillingGroup.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { contaId: 'tenant-a', standaloneChargeId: 'charge-1', status: 'REQUIRES_RECONCILIATION' },
      data: { status: 'OPEN' },
    }));
    expect(txMock.eventParticipant.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { contaId: 'tenant-a', standaloneChargeId: 'charge-1' },
      data: { asaasPaymentId: 'pay-1', asaasInstallmentId: 'installment-1' },
    }));
    expect(txMock.eventFinancialEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { contaId: 'tenant-a', id: { in: ['entry-1'] } },
      data: { paymentProvider: 'ASAAS', asaasPaymentId: 'pay-1' },
    }));
  });

  it('falha sem sobrescrever um vínculo de pagamento divergente', async () => {
    txMock.eventParticipant.findMany.mockResolvedValueOnce([{
      id: 'participant-1', revenueEntryId: 'entry-1', asaasPaymentId: 'pay-other', asaasInstallmentId: null,
    }]);

    await expect(linkReconciledEventRegistrationCharge({
      contaId: 'tenant-a', chargeId: 'charge-1', asaasPaymentId: 'pay-1',
    })).rejects.toThrow('EVENT_REGISTRATION_PAYMENT_LINK_CONFLICT');

    expect(txMock.eventParticipant.updateMany).not.toHaveBeenCalled();
    expect(txMock.eventBillingGroup.updateMany).not.toHaveBeenCalled();
    expect(txMock.eventFinancialEntry.updateMany).not.toHaveBeenCalled();
  });

  it('remove Em verificação somente depois de ler o estado atual do provedor', async () => {
    await settleReconciledEventRegistrationCharge({
      contaId: 'tenant-a', chargeId: 'charge-1', paymentStatus: 'RECEIVED',
    });

    expect(prismaMock.eventParticipant.updateMany).toHaveBeenCalledWith({
      where: {
        contaId: 'tenant-a',
        standaloneChargeId: 'charge-1',
        financialStatusSnapshot: 'EM_VERIFICACAO',
      },
      data: { financialStatusSnapshot: 'QUITADO' },
    });
  });

  it('mantém Em verificação enquanto estorno ou contestação continuam em andamento', async () => {
    await settleReconciledEventRegistrationCharge({
      contaId: 'tenant-a', chargeId: 'charge-1', paymentStatus: 'CHARGEBACK_REQUESTED',
    });

    expect(prismaMock.eventParticipant.updateMany).not.toHaveBeenCalled();
  });
});
