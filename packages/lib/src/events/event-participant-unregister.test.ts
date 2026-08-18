import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('../prisma', () => ({
  prisma: {
    eventParticipant: { findFirst: vi.fn() },
    eventFinancialEntry: { findFirst: vi.fn() },
    charge: { findMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '../prisma';
import { unregisterEventParticipant } from './events.service';

function createTransactionMock() {
  return {
    eventParticipant: {
      update: vi.fn().mockResolvedValue({ id: 'participant-1' }),
    },
    charge: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    eventFinancialEntry: {
      update: vi.fn().mockResolvedValue({ id: 'entry-1' }),
    },
    eventAudit: {
      create: vi.fn().mockResolvedValue({ id: 'event-audit-1' }),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({ id: 'audit-log-1' }),
    },
  };
}

describe('unregisterEventParticipant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('preserva como recebida a taxa manual já quitada ao cancelar a inscrição', async () => {
    const tx = createTransactionMock();
    vi.mocked(prisma.eventParticipant.findFirst).mockResolvedValue({
      id: 'participant-1',
      contaId: 'conta-1',
      eventId: 'event-1',
      alunoId: null,
      registrationFeeCharged: new Prisma.Decimal(780),
      isFeePaid: true,
      revenueEntryId: 'entry-1',
      asaasPaymentId: null,
      asaasInstallmentId: null,
      standaloneChargeId: null,
      cancelledAt: null,
      event: { status: 'ACTIVE' },
    } as never);
    vi.mocked(prisma.eventFinancialEntry.findFirst).mockResolvedValue({
      id: 'entry-1',
      contaId: 'conta-1',
      status: 'PENDING',
      actualAmount: new Prisma.Decimal(780),
      refundedAmount: new Prisma.Decimal(0),
      netAmount: null,
      asaasPaymentId: null,
      notes: null,
    } as never);
    vi.mocked(prisma.charge.findMany).mockResolvedValue([]);
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback(tx as never));

    await unregisterEventParticipant(
      { contaId: 'conta-1', userId: 'admin-1' },
      'event-1',
      'participant-1',
    );

    expect(tx.eventFinancialEntry.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'entry-1' },
      data: expect.objectContaining({
        status: 'RECEIVED',
        actualAmount: expect.anything(),
        cancelledAt: null,
      }),
    }));
  });
});
