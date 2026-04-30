/**
 * Agendamento/emissão de nota fiscal (Invoice / NFS-e) no Asaas
 *
 * Endpoint oficial: POST /v3/invoices
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasInvoice, CreateInvoiceInput } from '../types/asaas';

export interface CreateInvoiceParams {
  apiKey: string;
  data: CreateInvoiceInput;
  idempotencyKey?: string;
}

export async function createInvoice(params: CreateInvoiceParams): Promise<AsaasInvoice> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  const headers: Record<string, string> = {};
  if (params.idempotencyKey) {
    headers['Idempotency-Key'] = params.idempotencyKey;
  }

  return client.post<AsaasInvoice>('/invoices', params.data, { headers });
}
