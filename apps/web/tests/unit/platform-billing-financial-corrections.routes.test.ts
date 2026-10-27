/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  refund: vi.fn(),
  undo: vi.fn(),
  paymentMethod: vi.fn(),
  cancelChargeInvoice: vi.fn(),
  resolveCharge: vi.fn(),
  financialGate: vi.fn(),
  cancelInvoice: vi.fn(),
  markPaid: vi.fn(),
}));

vi.mock('@/lib/api/with-tenant-session', () => ({
  resolveTenantSession: vi.fn(async () => ({ ok: true, contaId: 'conta_a', userId: 'user_a', role: 'FINANCEIRO' })),
}));
vi.mock('@/src/server/platform-billing/capacity', () => ({
  platformBillingAccessResponseForConta: mocks.access,
}));
vi.mock('@/src/server/finance/refund-charge.service', () => ({ executeCobrancaRefund: mocks.refund }));
vi.mock('@/src/server/finance/undo-cash-payment.service', () => ({ executeUndoCashPayment: mocks.undo }));
vi.mock('@/src/server/finance/charge-payment-method.service', () => ({ updateCobrancaFormaPagamento: mocks.paymentMethod }));
vi.mock('@/features/finance/operations/charges/mappers', () => ({ mapCobrancaUpdateFormaPagamentoResultToDTO: (value: unknown) => value }));
vi.mock('@/lib/finance/resolve-charge-route-ref', () => ({ resolveChargeFromRouteRef: mocks.resolveCharge }));
vi.mock('@/lib/finance/financial-account-gate', () => ({ guardFinancialAccountOr412: mocks.financialGate }));
vi.mock('@alusa/finance', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alusa/finance')>()),
  cancelChargeInvoice: mocks.cancelChargeInvoice,
  cancelInvoice: mocks.cancelInvoice,
  markChargeAsPaid: mocks.markPaid,
  KycNotApprovedError: class extends Error {},
  AsaasEnvError: class extends Error {},
  AsaasHttpError: class extends Error { status = 500; },
}));

import { POST as refund } from '@/app/api/cobrancas/[id]/refund/route';
import { POST as undo } from '@/app/api/cobrancas/[id]/undo-receive-in-cash/route';
import { PUT as changeMethod } from '@/app/api/cobrancas/[id]/forma-pagamento/route';
import { POST as cancelChargeNf } from '@/app/api/cobrancas/[id]/nota-fiscal/cancelar/route';
import { POST as cancelInvoiceRoute } from '@/app/api/finance/invoices/[invoiceId]/cancel/route';
import { POST as markPaid } from '@/app/api/financeiro/cobrancas/[id]/marcar-pago/route';
import { assertPlatformAccess, PlatformBillingError, type PlatformBillingAccountRecord } from '@alusa/platform-billing';

const params = (id = 'charge_a') => ({ params: Promise.resolve({ id }) });
const request = (url: string, method = 'POST', body?: unknown) => new Request(url, {
  method,
  headers: { 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const routes = [
  { name: 'refund', call: () => refund(request('http://localhost/refund') as never, params()), service: mocks.refund },
  { name: 'undo cash receive', call: () => undo(request('http://localhost/undo') as never, params()), service: mocks.undo },
  { name: 'payment method correction', call: () => changeMethod(request('http://localhost/payment-method', 'PUT', { formaPagamento: 'PIX' }) as never, params()), service: mocks.paymentMethod },
  { name: 'charge tax invoice cancellation', call: () => cancelChargeNf(request('http://localhost/nf'), params()), service: mocks.cancelChargeInvoice },
  { name: 'finance invoice cancellation', call: () => cancelInvoiceRoute(request('http://localhost/invoice'), { params: Promise.resolve({ invoiceId: 'invoice_a' }) } as never), service: mocks.cancelInvoice },
  { name: 'manual payment correction', call: () => markPaid(request('http://localhost/mark-paid', 'POST', {}) as never, params()), service: mocks.markPaid },
];

describe('FINANCIAL_CORRECTION route capability', () => {
  let billingStatus: 'PENDING' | 'RESTRICTED' | 'CANCELED';
  beforeEach(() => {
    vi.clearAllMocks();
    billingStatus = 'RESTRICTED';
    mocks.access.mockImplementation(async ({ contaId, capability }) => {
      const account = {
        id: 'billing_a', contaId, environment: 'TEST',
        status: billingStatus === 'CANCELED' ? 'CANCELED' : billingStatus === 'PENDING' ? 'CHECKOUT_PENDING' : 'PAST_DUE',
        accessStatus: billingStatus, cancelAtPeriodEnd: false, currentPeriodEnd: null,
        trialEndsAt: null, firstPaidAt: new Date(), lastSuccessfulPaymentAt: new Date(),
        gracePeriodEndsAt: null, planCode: 'STARTER', restrictionReason: null,
      } as unknown as PlatformBillingAccountRecord;
      try {
        assertPlatformAccess({ contaId, account, capability });
        return null;
      } catch (error) {
        if (error instanceof PlatformBillingError && error.code === 'PLATFORM_BILLING_ACCESS_RESTRICTED') {
          return { status: 402, body: { error: error.code, message: 'restricted', details: error.details } };
        }
        throw error;
      }
    });
    mocks.refund.mockResolvedValue({ body: {}, status: 202 });
    mocks.undo.mockResolvedValue({ body: {}, status: 202 });
    mocks.paymentMethod.mockResolvedValue({ ok: true, data: { cobranca: { id: 'charge_a' }, asaasData: { id: 'pay_a' } } });
    mocks.resolveCharge.mockResolvedValue({ chargeId: 'charge_a' });
    mocks.financialGate.mockResolvedValue({ ok: true });
    mocks.cancelChargeInvoice.mockResolvedValue({ success: true, data: {} });
    mocks.cancelInvoice.mockResolvedValue({ success: true, data: {} });
    mocks.markPaid.mockResolvedValue({ success: true, data: { isOffline: true } });
  });

  it.each(routes)('blocks $name for PENDING before the action according to the billing policy', async ({ call, service }) => {
    billingStatus = 'PENDING';
    const response = await call();
    expect(response.status).toBe(402);
    expect(service).not.toHaveBeenCalled();
    expect(mocks.access).toHaveBeenCalledTimes(1);
    expect(mocks.access).toHaveBeenCalledWith({ contaId: 'conta_a', capability: 'FINANCIAL_CORRECTION' });
  });

  it.each(routes)('continues $name for RESTRICTED and CANCELED accounts because FINANCIAL_CORRECTION is allowed', async ({ call, service }) => {
    for (const status of ['RESTRICTED', 'CANCELED'] as const) {
      billingStatus = status;
      const response = await call();
      expect(response.status).not.toBe(402);
    }
    expect(service).toHaveBeenCalledTimes(2);
  });
});
