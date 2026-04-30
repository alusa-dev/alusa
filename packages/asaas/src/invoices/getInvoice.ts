/**
 * Consulta de nota fiscal (Invoice / NFS-e) no Asaas
 *
 * Endpoint oficial: GET /v3/invoices/{id}
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasInvoice } from '../types/asaas';

export interface GetInvoiceParams {
  apiKey: string;
  id: string;
}

export async function getInvoice(params: GetInvoiceParams): Promise<AsaasInvoice> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.get<AsaasInvoice>(`/invoices/${params.id}`);
}
