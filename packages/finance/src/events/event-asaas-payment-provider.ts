import {
  createCustomer,
  createPayment,
  deletePayment,
  getPixQrCode,
  listCustomers,
  listPayments,
  updateCustomer,
  type BillingType,
} from '@alusa/asaas';
import type { EventAsaasPaymentProvider } from '@alusa/lib';

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
  getPixQrCode: (params) => getPixQrCode(params),
  deletePayment: (params) => deletePayment(params),
};
