import { beforeEach, describe, expect, it, vi } from 'vitest';

const { financeUseCaseMock, executeRefundMock } = vi.hoisted(() => ({
  financeUseCaseMock: vi.fn(),
  executeRefundMock: vi.fn(),
}));

vi.mock('@alusa/finance', () => ({ requestStoreSaleRefund: financeUseCaseMock }));
vi.mock('@/src/server/finance/refund-charge.service', () => ({ executeCobrancaRefund: executeRefundMock }));

import { requestStoreSaleRefundFromApp } from '@/src/server/sales/store-sale-refund.service';

describe('requestStoreSaleRefundFromApp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    financeUseCaseMock.mockImplementation(async (input: { dispatch: (params: unknown) => Promise<unknown> }) => {
      await input.dispatch({
        contaId: 'tenant-a', actorId: 'user-a', role: 'FINANCEIRO', chargeId: 'charge-a',
        correlationId: 'correlation-a', returnId: 'return-a', attemptId: 'attempt-a',
        value: 25, description: 'Devolução Loja return-a',
      });
      return { status: 'IN_PROGRESS', pending: true };
    });
    executeRefundMock.mockResolvedValue({ status: 202, body: { pending: true } });
  });

  it('adapts the finance dispatch port to the existing refund command service', async () => {
    const result = await requestStoreSaleRefundFromApp({
      contaId: 'tenant-a', saleId: 'sale-a', returnId: 'return-a', actorId: 'user-a', role: 'FINANCEIRO', mode: 'RETRY_DENIED',
    });

    expect(result).toEqual({ status: 'IN_PROGRESS', pending: true });
    expect(executeRefundMock).toHaveBeenCalledWith({
      contaId: 'tenant-a', userId: 'user-a', role: 'FINANCEIRO', id: 'charge-a',
      correlationId: 'correlation-a', storeSaleReturnId: 'return-a', storeSaleRefundAttemptId: 'attempt-a',
      body: { value: 25, description: 'Devolução Loja return-a' },
    });
  });
});
