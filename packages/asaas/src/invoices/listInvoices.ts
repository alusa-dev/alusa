/**
 * Listagem de notas fiscais (Invoice / NFS-e) no Asaas.
 *
 * Endpoint oficial: GET /v3/invoices
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasInvoiceListResponse, AsaasInvoiceStatus } from '../types/asaas';

export interface ListInvoicesParams {
  apiKey: string;
  offset?: number;
  limit?: number;
  effectiveDateGe?: string;
  effectiveDateLe?: string;
  payment?: string;
  installment?: string;
  externalReference?: string;
  status?: AsaasInvoiceStatus;
  customer?: string;
}

export async function listInvoices(params: ListInvoicesParams): Promise<AsaasInvoiceListResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.get<AsaasInvoiceListResponse>('/invoices', {
    params: {
      offset: params.offset,
      limit: params.limit,
      'effectiveDate[Ge]': params.effectiveDateGe,
      'effectiveDate[Le]': params.effectiveDateLe,
      payment: params.payment,
      installment: params.installment,
      externalReference: params.externalReference,
      status: params.status,
      customer: params.customer,
    },
  });
}
