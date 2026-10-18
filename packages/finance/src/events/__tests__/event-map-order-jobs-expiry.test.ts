import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findOrder: vi.fn(),
  updateOrderMany: vi.fn(),
  findIssue: vi.fn(),
  loadCredentials: vi.fn(),
  upsertIssue: vi.fn(),
  resolveIssue: vi.fn(),
  confirmPayment: vi.fn(),
  reconcilePayment: vi.fn(),
  provider: {
    listPayments: vi.fn(),
    listCustomers: vi.fn(),
    getPayment: vi.fn(),
    deletePayment: vi.fn(),
  },
}));

vi.mock('@alusa/database', () => ({
  prisma: {
    eventMapOrder: { findFirst: mocks.findOrder, updateMany: mocks.updateOrderMany },
    financeReconciliationIssue: { findFirst: mocks.findIssue },
  },
}));
vi.mock('../../foundation/load-decrypted-asaas-credentials', () => ({ loadDecryptedAsaasCredentials: mocks.loadCredentials }));
vi.mock('../../foundation/webhook-job-lock.service', () => ({ withWebhookJobLock: vi.fn(async (_key: string, callback: () => unknown) => callback()) }));
vi.mock('../../reconciliation/finance-reconciliation-issue.service', () => ({
  upsertFinanceReconciliationIssue: mocks.upsertIssue,
  resolveFinanceReconciliationIssueByDedupe: mocks.resolveIssue,
}));
vi.mock('./confirm-public-event-map-order-payment', () => ({ confirmPublicEventMapOrderPayment: mocks.confirmPayment }));
vi.mock('./event-map-payment-transitions', () => ({
  markPublicEventMapOrderRefundProcessingByPayment: vi.fn(),
  reconcileEventMapOrderFinancialStateFromAsaas: mocks.reconcilePayment,
  refundPublicEventMapOrderByPayment: vi.fn(),
}));
vi.mock('../../use-cases/asaas-ops', () => ({ listPaymentRefunds: vi.fn() }));
vi.mock('./record-public-order-ticket-fulfillment-failure', () => ({ recordPublicOrderTicketFulfillmentFailure: vi.fn() }));
vi.mock('@alusa/lib/events/map/event-map-order-operations', () => ({ lockPublicEventMapReservation: vi.fn() }));
vi.mock('./reconcile-event-map-order-payment', () => ({ reconcileEventMapOrderPayment: vi.fn() }));

import { resolveEventMapPaymentAtExpiry } from '../event-map-order-jobs';
import { registerEventAsaasPaymentProvider } from '../event-asaas-payment-provider';

const externalReference = 'event-map-order:order-1';

describe('resolveEventMapPaymentAtExpiry buyer identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registerEventAsaasPaymentProvider(mocks.provider as never);
    mocks.loadCredentials.mockResolvedValue({ apiKey: 'tenant-A-key' });
    mocks.findOrder.mockResolvedValue({
      totalAmount: 20,
      paymentMethod: 'PIX',
      asaasCustomerId: null,
      buyerDocument: '123.456.789-01',
    });
    mocks.provider.listPayments.mockResolvedValue({
      offset: 0,
      limit: 100,
      totalCount: 1,
      hasMore: false,
      data: [{
        id: 'pay-paid-wrong-buyer',
        customer: 'cus-other',
        externalReference,
        value: 20,
        billingType: 'PIX',
        status: 'RECEIVED',
      }],
    });
    mocks.provider.listCustomers.mockResolvedValue({
      offset: 0,
      limit: 100,
      totalCount: 1,
      hasMore: false,
      data: [{ id: 'cus-expected', cpfCnpj: '12345678901' }],
    });
  });

  it('mantém a reserva e não confirma nem cancela pagamento pago de outro comprador', async () => {
    const result = await resolveEventMapPaymentAtExpiry({
      contaId: 'conta-A',
      eventId: 'event-1',
      orderId: 'order-1',
      now: new Date('2026-10-15T12:00:00Z'),
      paymentId: null,
      paymentCreationUnresolved: false,
      paymentCreationUpdatedAt: new Date('2026-10-15T10:00:00Z'),
      reservationId: 'reservation-1',
    });

    expect(result).toEqual({ decision: 'NOT_CANCELLABLE' });
    expect(mocks.provider.listCustomers).toHaveBeenCalledWith({
      apiKey: 'tenant-A-key',
      cpfCnpj: '12345678901',
      offset: 0,
      limit: 100,
    });
    expect(mocks.provider.getPayment).not.toHaveBeenCalled();
    expect(mocks.provider.deletePayment).not.toHaveBeenCalled();
    expect(mocks.confirmPayment).not.toHaveBeenCalled();
    expect(mocks.updateOrderMany).not.toHaveBeenCalled();
    expect(mocks.upsertIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-A',
      entityId: 'order-1',
      remoteStatus: 'PAYMENT_MISMATCH',
    }));
  });

  it('não confia em customer salvo se divergir do customer ativo do documento', async () => {
    mocks.findOrder.mockResolvedValue({
      totalAmount: 20,
      paymentMethod: 'PIX',
      asaasCustomerId: 'cus-stale',
      buyerDocument: '123.456.789-01',
    });
    mocks.provider.listPayments.mockResolvedValue({
      offset: 0,
      limit: 100,
      totalCount: 1,
      hasMore: false,
      data: [{
        id: 'pay-paid-stale-customer',
        customer: 'cus-stale',
        externalReference,
        value: 20,
        billingType: 'PIX',
        status: 'RECEIVED',
      }],
    });

    const result = await resolveEventMapPaymentAtExpiry({
      contaId: 'conta-A',
      eventId: 'event-1',
      orderId: 'order-1',
      now: new Date('2026-10-15T12:00:00Z'),
      paymentId: 'pay-paid-stale-customer',
      paymentCreationUnresolved: false,
      paymentCreationUpdatedAt: new Date('2026-10-15T10:00:00Z'),
      reservationId: 'reservation-1',
    });

    expect(result).toEqual({ decision: 'NOT_CANCELLABLE', paymentId: 'pay-paid-stale-customer' });
    expect(mocks.provider.listCustomers).toHaveBeenCalled();
    expect(mocks.provider.getPayment).not.toHaveBeenCalled();
    expect(mocks.provider.deletePayment).not.toHaveBeenCalled();
    expect(mocks.confirmPayment).not.toHaveBeenCalled();
    expect(mocks.updateOrderMany).not.toHaveBeenCalled();
    expect(mocks.upsertIssue).toHaveBeenCalledWith(expect.objectContaining({
      contaId: 'conta-A',
      remoteStatus: 'STORED_CUSTOMER_DOCUMENT_MISMATCH',
      metadata: expect.objectContaining({
        storedCustomerId: 'cus-stale',
        documentCustomerId: 'cus-expected',
      }),
    }));
  });
});
