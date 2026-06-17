/**
 * Atualização de nota fiscal agendada (Invoice / NFS-e) no Asaas.
 *
 * Endpoint oficial: PUT /v3/invoices/{id}
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasInvoice, UpdateInvoiceInput } from '../types/asaas';

export interface UpdateInvoiceParams {
  apiKey: string;
  id: string;
  data: UpdateInvoiceInput;
  idempotencyKey?: string;
}

export async function updateInvoice(params: UpdateInvoiceParams): Promise<AsaasInvoice> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  const headers: Record<string, string> = {};
  if (params.idempotencyKey) headers['Idempotency-Key'] = params.idempotencyKey;

  return client.put<AsaasInvoice>(`/invoices/${params.id}`, params.data, { headers });
}
