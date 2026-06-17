/**
 * Antecipação/emissão de nota fiscal agendada (Invoice / NFS-e) no Asaas.
 *
 * Endpoint oficial: POST /v3/invoices/{id}/authorize
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasInvoice } from '../types/asaas';

export interface AuthorizeInvoiceParams {
  apiKey: string;
  id: string;
}

export async function authorizeInvoice(params: AuthorizeInvoiceParams): Promise<AsaasInvoice> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  return client.post<AsaasInvoice>(`/invoices/${params.id}/authorize`, {});
}
