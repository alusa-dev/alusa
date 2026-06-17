/**
 * Cancelamento de nota fiscal (Invoice / NFS-e) no Asaas
 *
 * Endpoint oficial: POST /v3/invoices/{id}/cancel
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasInvoice } from '../types/asaas';

export interface CancelInvoiceParams {
  apiKey: string;
  id: string;
  cancelOnlyOnAsaas?: boolean;
}

export async function cancelInvoice(params: CancelInvoiceParams): Promise<AsaasInvoice> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  return client.post<AsaasInvoice>(
    `/invoices/${params.id}/cancel`,
    params.cancelOnlyOnAsaas === undefined
      ? {}
      : { cancelOnlyOnAsaas: params.cancelOnlyOnAsaas },
  );
}
