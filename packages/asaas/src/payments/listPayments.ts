/**
 * Lista payments no Asaas
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasPayment, BillingType, PaymentStatus } from '../types/asaas';

export interface AsaasListResponse<T> {
  object?: 'list' | string;
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: T[];
}

export interface ListPaymentsParams {
  apiKey: string;
  offset?: number;
  limit?: number;
  customer?: string;
  customerGroupName?: string;
  billingType?: BillingType;
  status?: PaymentStatus;
  subscription?: string;
  installment?: string;
  externalReference?: string;
  paymentDate?: string;
  invoiceStatus?: string;
  estimatedCreditDate?: string;
  pixQrCodeId?: string;
  anticipated?: boolean;
  anticipable?: boolean;
  'dateCreated[ge]'?: string;
  'dateCreated[le]'?: string;
  'paymentDate[ge]'?: string;
  'paymentDate[le]'?: string;
  'estimatedCreditDate[ge]'?: string;
  'estimatedCreditDate[le]'?: string;
  'dueDate[ge]'?: string;
  'dueDate[le]'?: string;
  deletedOnly?: boolean;
  includeDeleted?: boolean;
}

export async function listPayments(
  params: ListPaymentsParams,
): Promise<AsaasListResponse<AsaasPayment>> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  return client.get<AsaasListResponse<AsaasPayment>>('/payments', {
    params: {
      offset: params.offset,
      limit: params.limit,
      customer: params.customer,
      customerGroupName: params.customerGroupName,
      billingType: params.billingType,
      status: params.status,
      subscription: params.subscription,
      installment: params.installment,
      externalReference: params.externalReference,
      paymentDate: params.paymentDate,
      invoiceStatus: params.invoiceStatus,
      estimatedCreditDate: params.estimatedCreditDate,
      pixQrCodeId: params.pixQrCodeId,
      anticipated: params.anticipated,
      anticipable: params.anticipable,
      'dateCreated[ge]': params['dateCreated[ge]'],
      'dateCreated[le]': params['dateCreated[le]'],
      'paymentDate[ge]': params['paymentDate[ge]'],
      'paymentDate[le]': params['paymentDate[le]'],
      'estimatedCreditDate[ge]': params['estimatedCreditDate[ge]'],
      'estimatedCreditDate[le]': params['estimatedCreditDate[le]'],
      'dueDate[ge]': params['dueDate[ge]'],
      'dueDate[le]': params['dueDate[le]'],
      deletedOnly: params.deletedOnly ? 'true' : undefined,
      includeDeleted: params.includeDeleted ? 'true' : undefined,
    },
  });
}