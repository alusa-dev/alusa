import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPayment: vi.fn(),
  listSubscriptionPayments: vi.fn(),
  updatePayment: vi.fn(),
}));

vi.mock('../asaas-ops', () => ({
  getPayment: mocks.getPayment,
  listSubscriptionPayments: mocks.listSubscriptionPayments,
  updatePayment: mocks.updatePayment,
}));

import { syncEditableSubscriptionPayments } from './subscription-pending-payments-sync';

describe('syncEditableSubscriptionPayments', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listSubscriptionPayments.mockImplementation(async (_id, params) => ({
      offset: params.offset ?? 0,
      limit: params.limit ?? 100,
      data: params.status === 'PENDING'
        ? [{ id: 'payment-1', value: 120, dueDate: '2026-11-10', billingType: 'BOLETO' }]
        : [],
      totalCount: params.status === 'PENDING' ? 1 : 0,
      hasMore: false,
    }));
    mocks.getPayment.mockResolvedValue({
      id: 'payment-1',
      status: 'PENDING',
      interest: { value: 0 },
      fine: { value: 0, type: 'PERCENTAGE' },
      discount: { value: 0, type: 'PERCENTAGE', dueDateLimitDays: 0 },
    });
    mocks.updatePayment.mockResolvedValue({});
  });

  it('falha fechado quando hasMore está ausente e não atualiza pagamentos', async () => {
    mocks.listSubscriptionPayments.mockResolvedValueOnce({
      data: [{ id: 'payment-1', value: 120, dueDate: '2026-11-10', billingType: 'BOLETO' }],
      offset: 0, limit: 100, totalCount: 1,
    } as never);
    await expect(syncEditableSubscriptionPayments({
      contaId: 'conta-1', asaasSubscriptionId: 'sub-1', terms: { interest: { value: 1 } },
    })).rejects.toThrow('ASAAS_LIST_INCOMPLETE:INVALID_PAGE');
    expect(mocks.updatePayment).not.toHaveBeenCalled();
  });

  it('reporta divergência quando o Asaas mantém os termos anteriores', async () => {
    const result = await syncEditableSubscriptionPayments({
      contaId: 'conta-1',
      asaasSubscriptionId: 'sub-1',
      terms: {
        interest: { value: 1 },
        fine: { value: 2, type: 'FIXED' },
        discount: { value: 5, type: 'PERCENTAGE', dueDateLimitDays: 3 },
      },
    });

    expect(mocks.updatePayment).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ scanned: 1, updated: 0, failed: 1 });
    expect(result.failures[0]?.message).toContain('termos solicitados');
  });

  it('não atualiza uma cobrança após perder a lease', async () => {
    const assertLeaseOwned = vi.fn().mockRejectedValue(new Error('ENROLLMENT_FINANCIAL_COMMAND_LEASE_LOST'));

    const result = await syncEditableSubscriptionPayments({
      contaId: 'conta-1',
      asaasSubscriptionId: 'sub-1',
      terms: { interest: { value: 1 } },
      assertLeaseOwned,
    });

    expect(assertLeaseOwned).toHaveBeenCalledTimes(1);
    expect(mocks.updatePayment).not.toHaveBeenCalled();
    expect(result).toMatchObject({ scanned: 1, updated: 0, failed: 1 });
  });
});
