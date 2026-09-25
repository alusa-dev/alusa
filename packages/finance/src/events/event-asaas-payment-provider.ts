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
import type { EventAsaasPaymentProvider } from '@alusa/lib/events/event-asaas-payment-provider';

export const eventAsaasPaymentProvider: EventAsaasPaymentProvider = {
  listCustomers: (params) => listCustomers(params),
  createCustomer: (params) => createCustomer(params),
  updateCustomer: (params) => updateCustomer(params),
  createPayment: (params) =>
    createPayment({
      ...params,
      data: {
        ...params.data,
        billingType: params.data.billingType as BillingType,
      },
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
