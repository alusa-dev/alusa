import {
  createCustomer,
  createPayment,
  deletePayment,
  getPayment,
  getBillingInfo,
  getPixQrCode,
  listCustomers,
  listPayments,
  updateCustomer,
  type BillingType,
} from '@alusa/asaas';
import { assertCompleteAsaasPage } from '../use-cases/asaas-pagination';

export type EventAsaasCustomer = { id: string; cpfCnpj?: string; deleted?: boolean };
export type EventAsaasCustomerListResponse = {
  data: EventAsaasCustomer[];
  hasMore: boolean;
  offset: number;
  limit: number;
  totalCount: number;
};

export type EventAsaasPayment = {
  id: string;
  customer?: string;
  billingType?: string;
  externalReference?: string;
  status?: string;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  value?: number;
  invoiceUrl?: string | null;
  deleted?: boolean;
};

export type EventAsaasPaymentListResponse = {
  data: EventAsaasPayment[];
  hasMore: boolean;
  offset: number;
  limit: number;
  totalCount: number;
};

export type EventPixQrCode = { encodedImage: string; payload: string; expirationDate: string };
export type EventBankSlipBillingInfo = { identificationField: string | null; barCode: string | null };

export type EventAsaasPaymentProvider = {
  listCustomers(_params: { apiKey: string; cpfCnpj?: string; externalReference?: string; offset?: number; limit?: number }): Promise<EventAsaasCustomerListResponse>;
  createCustomer(_params: { apiKey: string; idempotencyKey?: string; data: { name: string; email?: string; cpfCnpj: string; mobilePhone?: string; address?: string; addressNumber?: string; complement?: string; province?: string; postalCode?: string; externalReference?: string; notificationDisabled?: boolean } }): Promise<EventAsaasCustomer>;
  updateCustomer(_params: { apiKey: string; customerId: string; data: { name?: string; email?: string; mobilePhone?: string; address?: string; addressNumber?: string; complement?: string; province?: string; postalCode?: string; externalReference?: string; notificationDisabled?: boolean } }): Promise<EventAsaasCustomer>;
  createPayment(_params: { apiKey: string; idempotencyKey?: string; data: { customer: string; value: number; dueDate: string; billingType: string; description?: string; externalReference?: string } }): Promise<EventAsaasPayment>;
  listPayments(_params: { apiKey: string; externalReference?: string; offset?: number; limit?: number }): Promise<EventAsaasPaymentListResponse>;
  getPayment(_params: { apiKey: string; paymentId: string }): Promise<EventAsaasPayment>;
  getPixQrCode(_params: { apiKey: string; paymentId: string }): Promise<EventPixQrCode>;
  getBankSlipBillingInfo(_params: { apiKey: string; paymentId: string }): Promise<EventBankSlipBillingInfo | null>;
  deletePayment(_params: { apiKey: string; paymentId: string }): Promise<EventAsaasPayment>;
};

let registeredEventAsaasPaymentProvider: EventAsaasPaymentProvider | null = null;

export function registerEventAsaasPaymentProvider(provider: EventAsaasPaymentProvider): void {
  registeredEventAsaasPaymentProvider = provider;
}

export function getEventAsaasPaymentProvider(): EventAsaasPaymentProvider {
  if (!registeredEventAsaasPaymentProvider) throw new Error('Event payment provider not registered');
  return registeredEventAsaasPaymentProvider;
}

export async function listCompleteEventPaymentsByReference(input: {
  apiKey: string;
  externalReference: string;
}): Promise<EventAsaasPayment[]> {
  const payments: EventAsaasPayment[] = [];
  const seenIds = new Set<string>();
  const pageSize = 100;
  let expectedTotalCount: number | undefined;

  for (let page = 0; page < 100; page += 1) {
    const offset = page * pageSize;
    let response: EventAsaasPaymentListResponse;
    try {
      response = await getEventAsaasPaymentProvider().listPayments({
        apiKey: input.apiKey,
        externalReference: input.externalReference,
        offset,
        limit: pageSize,
      });
    } catch (error) {
      throw new Error(`EVENT_PAYMENT_REFERENCE_LOOKUP_INCOMPLETE:${error instanceof Error ? error.message : String(error)}`);
    }
    if (
      !response ||
      !Array.isArray(response.data) ||
      typeof response.hasMore !== 'boolean' ||
      response.offset !== offset ||
      response.limit !== pageSize
    ) {
      throw new Error('EVENT_PAYMENT_REFERENCE_LOOKUP_INCOMPLETE:INVALID_PAGE');
    }
    try { expectedTotalCount = assertCompleteAsaasPage(response, offset, pageSize, expectedTotalCount); }
    catch { throw new Error('EVENT_PAYMENT_REFERENCE_LOOKUP_INCOMPLETE:TOTAL_COUNT_MISMATCH'); }
    if (response.data.some((payment) =>
      !payment?.id || seenIds.has(payment.id) || payment.externalReference !== input.externalReference,
    )) {
      throw new Error('EVENT_PAYMENT_REFERENCE_LOOKUP_INCOMPLETE:REPEATED_OR_MISMATCHED_RESULT');
    }
    for (const payment of response.data) {
      seenIds.add(payment.id);
      payments.push(payment);
    }
    if (!response.hasMore) return payments;
    if (response.data.length === 0) {
      throw new Error('EVENT_PAYMENT_REFERENCE_LOOKUP_INCOMPLETE:EMPTY_PAGE_WITH_MORE');
    }
  }

  throw new Error('EVENT_PAYMENT_REFERENCE_LOOKUP_INCOMPLETE:PAGE_LIMIT_EXCEEDED');
}

export function selectUniqueActiveEventPayment(
  payments: EventAsaasPayment[],
): EventAsaasPayment | null {
  const activePayments = payments.filter((payment) => !payment.deleted);
  if (activePayments.length > 1) {
    throw new Error('EVENT_PAYMENT_REFERENCE_LOOKUP_AMBIGUOUS:MULTIPLE_ACTIVE_PAYMENTS');
  }
  return activePayments[0] ?? null;
}

export async function listCompleteEventCustomersByDocument(input: {
  apiKey: string;
  cpfCnpj: string;
}): Promise<EventAsaasCustomer[]> {
  const customers: EventAsaasCustomer[] = [];
  const seenIds = new Set<string>();
  const pageSize = 100;
  let expectedTotalCount: number | undefined;

  for (let page = 0; page < 100; page += 1) {
    const offset = page * pageSize;
    let response: EventAsaasCustomerListResponse;
    try {
      response = await getEventAsaasPaymentProvider().listCustomers({
        apiKey: input.apiKey,
        cpfCnpj: input.cpfCnpj,
        offset,
        limit: pageSize,
      });
    } catch (error) {
      throw new Error(`EVENT_CUSTOMER_LOOKUP_INCOMPLETE:${error instanceof Error ? error.message : String(error)}`);
    }
    if (
      !response ||
      !Array.isArray(response.data) ||
      typeof response.hasMore !== 'boolean' ||
      response.offset !== offset ||
      response.limit !== pageSize
    ) {
      throw new Error('EVENT_CUSTOMER_LOOKUP_INCOMPLETE:INVALID_PAGE');
    }
    try { expectedTotalCount = assertCompleteAsaasPage(response, offset, pageSize, expectedTotalCount); }
    catch { throw new Error('EVENT_CUSTOMER_LOOKUP_INCOMPLETE:TOTAL_COUNT_MISMATCH'); }
    if (response.data.some((customer) => !customer?.id || seenIds.has(customer.id))) {
      throw new Error('EVENT_CUSTOMER_LOOKUP_INCOMPLETE:REPEATED_OR_INVALID_ID');
    }
    for (const customer of response.data) {
      seenIds.add(customer.id);
      if (customer.cpfCnpj?.replace(/\D/g, '') === input.cpfCnpj) customers.push(customer);
    }
    if (!response.hasMore) return customers;
    if (response.data.length === 0) throw new Error('EVENT_CUSTOMER_LOOKUP_INCOMPLETE:EMPTY_PAGE_WITH_MORE');
  }

  throw new Error('EVENT_CUSTOMER_LOOKUP_INCOMPLETE:PAGE_LIMIT_EXCEEDED');
}

export const eventAsaasPaymentProvider: EventAsaasPaymentProvider = {
  listCustomers: (params) => listCustomers(params),
  createCustomer: (params) => createCustomer(params),
  updateCustomer: (params) => updateCustomer(params),
  createPayment: (params) => createPayment({
    ...params,
    data: { ...params.data, billingType: params.data.billingType as BillingType },
  }),
  listPayments: (params) => listPayments(params),
  getPayment: (params) => getPayment(params),
  getPixQrCode: (params) => getPixQrCode(params),
  getBankSlipBillingInfo: async (params) => {
    const result = await getBillingInfo(params);
    if (!result.bankSlip) return null;
    return {
      identificationField: result.bankSlip.identificationField ?? null,
      barCode: result.bankSlip.barCode ?? null,
    };
  },
  deletePayment: (params) => deletePayment(params),
};
