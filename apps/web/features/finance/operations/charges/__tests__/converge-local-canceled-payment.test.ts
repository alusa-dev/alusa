import { beforeEach, describe, expect, it, vi } from 'vitest';

const { prismaMock, transactionMock } = vi.hoisted(() => ({
  prismaMock: {
    $transaction: vi.fn(),
  },
  transactionMock: {
    cobranca: { updateMany: vi.fn() },
    charge: { updateMany: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
  default: prismaMock,
}));

import { convergeLocalCanceledPayment } from '../converge-local-canceled-payment';

describe('convergeLocalCanceledPayment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof transactionMock) => Promise<void>) =>
      callback(transactionMock),
    );
    transactionMock.cobranca.updateMany.mockResolvedValue({ count: 1 });
    transactionMock.charge.updateMany.mockResolvedValue({ count: 1 });
  });

  it('mantém contaId em ambas as escritas e preserva estados terminais', async () => {
    await convergeLocalCanceledPayment({
      contaId: 'conta-a',
      cobrancaId: 'cobranca-a',
      chargeId: 'charge-a',
      asaasPaymentId: 'pay-a',
      actorId: 'user-a',
      reason: 'cancelamento solicitado',
    });

    expect(transactionMock.cobranca.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'cobranca-a',
        contaId: 'conta-a',
        status: { notIn: ['CANCELADO', 'PAGO', 'ESTORNADO', 'ESTORNADO_PARCIAL'] },
      }),
      data: expect.objectContaining({
        status: 'CANCELADO',
        canceladoMotivo: 'cancelamento solicitado',
        canceladoPor: 'user-a',
      }),
    });

    expect(transactionMock.charge.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        contaId: 'conta-a',
        OR: [{ id: 'charge-a' }, { cobrancaId: 'cobranca-a' }, { asaasPaymentId: 'pay-a' }],
        status: { notIn: ['CANCELED', 'PAID', 'REFUNDED'] },
      }),
      data: expect.objectContaining({
        status: 'CANCELED',
        asaasStatus: 'DELETED',
      }),
    });
  });

  it('não executa update de Charge sem um identificador de Charge', async () => {
    await convergeLocalCanceledPayment({ contaId: 'conta-a' });

    expect(transactionMock.cobranca.updateMany).not.toHaveBeenCalled();
    expect(transactionMock.charge.updateMany).not.toHaveBeenCalled();
  });
});
