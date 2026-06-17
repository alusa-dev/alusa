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
}

export async function createInvoice(params: CreateInvoiceParams): Promise<AsaasInvoice> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  return client.post<AsaasInvoice>('/invoices', params.data);
}
