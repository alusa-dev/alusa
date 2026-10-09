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

export type EventAsaasCustomer = { id: string; deleted?: boolean };

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

export type EventPixQrCode = { encodedImage: string; payload: string; expirationDate: string };
export type EventBankSlipBillingInfo = { identificationField: string | null; barCode: string | null };

export type EventAsaasPaymentProvider = {
  listCustomers(_params: { apiKey: string; cpfCnpj?: string; externalReference?: string; limit?: number }): Promise<{ data: EventAsaasCustomer[] }>;
  createCustomer(_params: { apiKey: string; idempotencyKey?: string; data: { name: string; email?: string; cpfCnpj: string; mobilePhone?: string; address?: string; addressNumber?: string; complement?: string; province?: string; postalCode?: string; externalReference?: string; notificationDisabled?: boolean } }): Promise<EventAsaasCustomer>;
  updateCustomer(_params: { apiKey: string; customerId: string; data: { name?: string; email?: string; mobilePhone?: string; address?: string; addressNumber?: string; complement?: string; province?: string; postalCode?: string; externalReference?: string; notificationDisabled?: boolean } }): Promise<EventAsaasCustomer>;
  createPayment(_params: { apiKey: string; idempotencyKey?: string; data: { customer: string; value: number; dueDate: string; billingType: string; description?: string; externalReference?: string } }): Promise<EventAsaasPayment>;
  listPayments(_params: { apiKey: string; externalReference?: string; limit?: number }): Promise<{ data: EventAsaasPayment[] }>;
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
