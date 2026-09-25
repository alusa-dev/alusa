import {
  registerEventAsaasPaymentProvider,
  type EventAsaasPayment,
  type EventAsaasPaymentProvider,
} from '@alusa/lib/events/event-asaas-payment-provider';
import {
  eventAsaasPaymentProvider,
  registerFinanceSideEffectEmailGatewayForTests,
  registerFinanceSideEffectRefundGatewayForTests,
  type FinanceSideEffectEmailGateway,
  type FinanceSideEffectRefundGateway,
} from '@alusa/finance';
import { prisma } from '@alusa/database';

let registered = false;
const testPayments = new Map<string, EventAsaasPayment>();
const testRefunds = new Map<string, Array<{
  dateCreated: string;
  status: 'PENDING' | 'DONE' | 'CANCELLED';
  value: number;
  description: string;
}>>();
const playwrightEmailGateway: FinanceSideEffectEmailGateway = {
  sendBankSlipRefundNotice: async () => ({ id: 'playwright-bank-slip-refund-email' }),
};

const playwrightRefundGateway: FinanceSideEffectRefundGateway = {
  listPaymentRefunds: async ({ paymentId }) => ({ data: testRefunds.get(paymentId) ?? [] }),
  requestBankSlipRefund: async ({ paymentId }) => ({
    requestUrl: `https://sandbox.asaas.com/solicitar-estorno/${encodeURIComponent(paymentId)}`,
  }),
  refundCobranca: async ({ paymentId, value = 0, description = '' }) => {
    if (paymentId === 'pay-refund-rejection-e2e') {
      throw Object.assign(new Error('PLAYWRIGHT_REFUND_REJECTED'), { status: 400 });
    }
    const refunds = testRefunds.get(paymentId) ?? [];
    if (!refunds.some((refund) => refund.description === description && refund.value === value)) {
      refunds.push({ dateCreated: new Date().toISOString(), status: 'PENDING', value, description });
      testRefunds.set(paymentId, refunds);
    }
    return { success: true, message: 'Estorno de teste solicitado.' };
  },
};

async function findPlaywrightPayment(paymentId: string, externalReference?: string): Promise<EventAsaasPayment | null> {
  const orderId = externalReference?.startsWith('event-map-order:')
    ? externalReference.slice('event-map-order:'.length)
    : paymentId.startsWith('playwright-event-map-order:')
      ? paymentId.slice('playwright-event-map-order:'.length)
      : null;
  if (!orderId) return null;
  const order = await prisma.eventMapOrder.findFirst({
    where: {
      id: orderId,
      asaasPaymentId: paymentId,
    },
    select: { asaasCustomerId: true, paymentMethod: true, paymentStatus: true, totalAmount: true, invoiceUrl: true },
  });
  if (!order) return null;
  return {
    id: paymentId,
    customer: order.asaasCustomerId ?? 'playwright-customer',
    billingType: order.paymentMethod ?? 'PIX',
    externalReference: `event-map-order:${orderId}`,
    status: order.paymentStatus ?? 'PENDING',
    value: Number(order.totalAmount),
    invoiceUrl: order.invoiceUrl ?? `https://playwright.invalid/event-map-order:${orderId}`,
    deleted: false,
  };
}

const playwrightPaymentProvider: EventAsaasPaymentProvider = {
  listCustomers: async ({ cpfCnpj }) => {
    if (cpfCnpj === '11144477735') throw new Error('PLAYWRIGHT_CUSTOMER_LOOKUP_UNAVAILABLE');
    return { data: [] };
  },
  createCustomer: async ({ data }) => ({
    id: data.name === 'Comprador com resposta perdida' ? 'playwright-lost-response-customer' : 'playwright-customer',
  }),
  updateCustomer: async ({ customerId }) => ({ id: customerId }),
  createPayment: async (params) => {
    const payment: EventAsaasPayment = {
      id: `playwright-${params.data.externalReference ?? 'payment'}`,
      customer: params.data.customer,
      billingType: params.data.billingType,
      externalReference: params.data.externalReference,
      status: 'PENDING',
      value: params.data.value,
      invoiceUrl: `https://playwright.invalid/${params.data.externalReference ?? 'payment'}`,
      deleted: false,
    };
    testPayments.set(payment.id, payment);
    if (params.data.customer === 'playwright-lost-response-customer') {
      throw new Error('PLAYWRIGHT_PAYMENT_RESPONSE_LOST_AFTER_PROVIDER_ACCEPTED');
    }
    return payment;
  },
  listPayments: async (params) => {
    const cached = [...testPayments.values()].filter((payment) =>
      !params.externalReference || payment.externalReference === params.externalReference,
    );
    if (cached.length || !params.externalReference) return { data: cached };
    const recovered = await findPlaywrightPayment(
      `playwright-${params.externalReference}`,
      params.externalReference,
    );
    return { data: recovered ? [recovered] : [] };
  },
  getPayment: async ({ paymentId }) => {
    const payment = testPayments.get(paymentId) ?? await findPlaywrightPayment(paymentId);
    if (!payment) throw new Error('PLAYWRIGHT_PAYMENT_NOT_FOUND');
    return payment;
  },
  getPixQrCode: async () => ({
    encodedImage: 'cGxheXdyaWdodC1waXg=',
    payload: 'playwright-pix-payload',
    expirationDate: new Date(Date.now() + 60_000).toISOString(),
  }),
  getBankSlipBillingInfo: async () => ({
    identificationField: '34191.79001 01043.510047 91020.150008 8 00000000000000',
    barCode: '34191000000000000000000000000000000000000000',
  }),
  deletePayment: async ({ paymentId }) => {
    const payment = testPayments.get(paymentId);
    if (payment) testPayments.set(paymentId, { ...payment, deleted: true, status: 'DELETED' });
    return { id: paymentId, deleted: true };
  },
};

export function ensureEventAsaasPaymentProviderRegistered(): void {
  if (registered) return;
  const isPlaywright = process.env.PLAYWRIGHT_TEST === 'true';
  registerEventAsaasPaymentProvider(isPlaywright ? playwrightPaymentProvider : eventAsaasPaymentProvider);
  if (isPlaywright) {
    registerFinanceSideEffectRefundGatewayForTests(playwrightRefundGateway);
    registerFinanceSideEffectEmailGatewayForTests(playwrightEmailGateway);
  }
  registered = true;
}
