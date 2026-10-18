import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listInstallmentPayments: vi.fn(),
  syncPaymentStateFromAsaas: vi.fn(),
  logFinanceOperationalEvent: vi.fn(),
}));

vi.mock('../asaas-ops', () => ({ listInstallmentPayments: mocks.listInstallmentPayments }));
vi.mock('../sync-payment-state-from-asaas', () => ({ syncPaymentStateFromAsaas: mocks.syncPaymentStateFromAsaas }));
vi.mock('../../foundation/operational-log', () => ({ logFinanceOperationalEvent: mocks.logFinanceOperationalEvent }));
vi.mock('@alusa/database', () => ({ prisma: {} }));
vi.mock('../mappers/asaas-subscription-status', () => ({ mapAsaasSubscriptionStatus: vi.fn() }));
vi.mock('../webhooks/subscription-webhook-handler', () => ({ handleSubscriptionWebhook: vi.fn() }));

import { convergeInstallmentPlansWithAsaas } from '../financial-read-convergence';

describe('convergeInstallmentPlansWithAsaas pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.syncPaymentStateFromAsaas.mockResolvedValue({ success: true });
  });

  it('sincroniza pagamentos encontrados em páginas posteriores com o tenant', async () => {
    mocks.listInstallmentPayments
      .mockResolvedValueOnce({
        object: 'list', totalCount: 101, offset: 0, limit: 100, hasMore: true,
        data: Array.from({ length: 100 }, (_, index) => ({ id: index === 0 ? 'payment-page-1' : `filler-${index}`, installment: 'installment-A' })),
      })
      .mockResolvedValueOnce({
        object: 'list', totalCount: 101, offset: 100, limit: 100, hasMore: false,
        data: [{ id: 'payment-page-2' }],
      });

    await expect(convergeInstallmentPlansWithAsaas({
      contaId: 'conta-A', plans: [{ id: 'plan-A', asaasInstallmentId: 'installment-A' }],
    })).resolves.toBe(true);

    expect(mocks.listInstallmentPayments.mock.calls.map(([id, options]) => [id, options.contaId, options.offset]))
      .toEqual([['installment-A', 'conta-A', 0], ['installment-A', 'conta-A', 100]]);
    expect(mocks.syncPaymentStateFromAsaas).toHaveBeenNthCalledWith(1, { contaId: 'conta-A', asaasPaymentId: 'payment-page-1' });
    expect(mocks.syncPaymentStateFromAsaas).toHaveBeenCalledWith({ contaId: 'conta-A', asaasPaymentId: 'payment-page-2' });
  });

  it('não sincroniza página parcial quando a consulta falha antes de hasMore=false', async () => {
    mocks.listInstallmentPayments
      .mockResolvedValueOnce({
        object: 'list', totalCount: 101, offset: 0, limit: 100, hasMore: true,
        data: Array.from({ length: 100 }, (_, index) => ({ id: index === 0 ? 'payment-page-1' : `filler-${index}`, installment: 'installment-A' })),
      })
      .mockRejectedValueOnce(new Error('page unavailable'));

    await expect(convergeInstallmentPlansWithAsaas({
      contaId: 'conta-A', plans: [{ id: 'plan-A', asaasInstallmentId: 'installment-A' }],
    })).resolves.toBe(false);

    expect(mocks.syncPaymentStateFromAsaas).not.toHaveBeenCalled();
    expect(mocks.logFinanceOperationalEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'finance.use_cases.financial_read_convergence.degraded',
    }));
  });

  it('não sincroniza quando uma página repete payment já observado', async () => {
    mocks.listInstallmentPayments
      .mockResolvedValueOnce({
        object: 'list', totalCount: 101, offset: 0, limit: 100, hasMore: true,
        data: Array.from({ length: 100 }, (_, index) => ({ id: index === 0 ? 'payment-duplicate' : `filler-${index}`, installment: 'installment-A' })),
      })
      .mockResolvedValueOnce({
        object: 'list', totalCount: 101, offset: 100, limit: 100, hasMore: false,
        data: [{ id: 'payment-duplicate' }],
      });

    await expect(convergeInstallmentPlansWithAsaas({
      contaId: 'conta-A', plans: [{ id: 'plan-A', asaasInstallmentId: 'installment-A' }],
    })).resolves.toBe(false);

    expect(mocks.syncPaymentStateFromAsaas).not.toHaveBeenCalled();
    expect(mocks.logFinanceOperationalEvent).toHaveBeenCalled();
  });

  it.each([
    ['offset', { offset: 1, limit: 100 }],
    ['limit', { offset: 0, limit: 99 }],
  ])('não sincroniza se o Asaas responder com %s inconsistente', async (_field, pagination) => {
    mocks.listInstallmentPayments.mockResolvedValueOnce({
      object: 'list', totalCount: 1, ...pagination, hasMore: false,
      data: [{ id: 'payment-candidate' }],
    });

    await expect(convergeInstallmentPlansWithAsaas({
      contaId: 'conta-A', plans: [{ id: 'plan-A', asaasInstallmentId: 'installment-A' }],
    })).resolves.toBe(false);

    expect(mocks.syncPaymentStateFromAsaas).not.toHaveBeenCalled();
    expect(mocks.logFinanceOperationalEvent).toHaveBeenCalled();
  });

  it('não sincroniza quando a paginação não conclui dentro do limite seguro', async () => {
    mocks.listInstallmentPayments.mockImplementation(async (_id, options) => ({
      object: 'list', totalCount: 10_001, offset: options.offset, limit: 100, hasMore: true,
      data: Array.from({ length: 100 }, (_, index) => ({ id: `payment-${options.offset}-${index}` })),
    }));

    await expect(convergeInstallmentPlansWithAsaas({
      contaId: 'conta-A', plans: [{ id: 'plan-A', asaasInstallmentId: 'installment-A' }],
    })).resolves.toBe(false);

    expect(mocks.listInstallmentPayments).toHaveBeenCalledTimes(100);
    expect(mocks.syncPaymentStateFromAsaas).not.toHaveBeenCalled();
    expect(mocks.logFinanceOperationalEvent).toHaveBeenCalled();
  });
});
