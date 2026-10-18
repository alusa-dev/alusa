import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listSubscriptions: vi.fn(),
  listSubscriptionPayments: vi.fn(),
  listPaymentsFromOps: vi.fn(),
  loadAsaasCredentials: vi.fn(),
}));

vi.mock('@alusa/asaas', () => ({
  createSubscription: vi.fn(), listSubscriptions: mocks.listSubscriptions,
  listSubscriptionPayments: mocks.listSubscriptionPayments,
  getSubscription: vi.fn(), deleteSubscription: vi.fn(), getPayment: vi.fn(), deletePayment: vi.fn(),
  updatePayment: vi.fn(), updateSubscription: vi.fn(),
}));
vi.mock('@alusa/database', () => ({ loadAsaasCredentials: mocks.loadAsaasCredentials }));
vi.mock('../use-cases/asaas-ops', () => ({
  listSubscriptionPayments: mocks.listPaymentsFromOps,
  getSubscription: vi.fn(), deleteSubscription: vi.fn(), getPayment: vi.fn(), deletePayment: vi.fn(),
  updatePayment: vi.fn(), updateSubscription: vi.fn(),
}));
vi.mock('../foundation/kyc-guard', () => ({ requireKycApproved: vi.fn() }));
vi.mock('../webhooks/ensure-webhook-config-operational', () => ({ ensureWebhookConfigOperational: vi.fn() }));

import { createAsaasBillingAgreementPort } from './asaas-subscription.adapter';

const page = <T>(data: T[], offset: number, totalCount: number, hasMore: boolean) => ({
  data, offset, limit: 100, totalCount, hasMore,
});

describe('Asaas subscription adapter pagination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadAsaasCredentials.mockResolvedValue({ apiKey: 'key', contaId: 'tenant-1' });
    mocks.listPaymentsFromOps.mockImplementation(async (_id: string, params: { offset: number }) =>
      page(Array.from({ length: params.offset === 0 ? 100 : 1 }, (_, index) => ({
        id: `pay-${params.offset}-${index}`, status: 'PENDING', value: 10, dueDate: '2026-11-10', billingType: 'BOLETO',
      })), params.offset, 101, params.offset === 0));
    mocks.listSubscriptions.mockImplementation(async ({ offset }: { offset: number }) =>
      page(Array.from({ length: offset === 0 ? 100 : 1 }, (_, index) => ({
        id: `sub-${offset}-${index}`, customer: 'cus-1', value: 10, billingType: 'BOLETO', cycle: 'MONTHLY', status: 'ACTIVE', nextDueDate: '2026-11-10', externalReference: 'ref-1',
      })), offset, 101, offset === 0));
  });

  it('paginates payments and identity lookup through all pages', async () => {
    const port = createAsaasBillingAgreementPort();
    const payments = await port.listSubscriptionPayments({ contaId: 'tenant-1', subscriptionId: 'sub-root' });
    expect(payments).toHaveLength(101);
    expect(mocks.listPaymentsFromOps.mock.calls.map(([, params]) => params.offset)).toEqual([0, 100]);

    await expect(port.findSubscriptionByExternalReference({ contaId: 'tenant-1', externalReference: 'ref-1' }))
      .rejects.toThrow('ASAAS_SUBSCRIPTION_LOOKUP_AMBIGUOUS');
    expect(mocks.listSubscriptions.mock.calls.map(([params]) => params.offset)).toEqual([0, 100]);
  });

  it('fails closed on contradictory totalCount metadata', async () => {
    mocks.listPaymentsFromOps.mockResolvedValueOnce(page([], 0, 1, false));
    await expect(createAsaasBillingAgreementPort().listSubscriptionPayments({ contaId: 'tenant-1', subscriptionId: 'sub-1' }))
      .rejects.toThrow('ASAAS_LIST_INCOMPLETE:TOTAL_COUNT_MISMATCH');
    expect(mocks.listPaymentsFromOps).toHaveBeenCalledTimes(1);
  });

  it('fails closed at the pagination cap', async () => {
    mocks.listSubscriptions.mockImplementation(async ({ offset }: { offset: number }) => page(
      Array.from({ length: 100 }, (_, index) => ({
        id: `sub-${offset}-${index}`, customer: 'cus-1', value: 10, billingType: 'BOLETO', cycle: 'MONTHLY', status: 'ACTIVE', nextDueDate: '2026-11-10', externalReference: 'ref-1',
      })), offset, 10001, true,
    ));
    await expect(createAsaasBillingAgreementPort().findSubscriptionByExternalReference({ contaId: 'tenant-1', externalReference: 'ref-1' }))
      .rejects.toThrow('ASAAS_SUBSCRIPTION_LOOKUP_INCOMPLETE:PAGE_LIMIT_REACHED');
    expect(mocks.listSubscriptions).toHaveBeenCalledTimes(100);
  });
});
