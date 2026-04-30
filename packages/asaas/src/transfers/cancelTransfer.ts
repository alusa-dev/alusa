/**
 * Cancelamento de transferência no Asaas.
 *
 * Endpoint oficial: DELETE /v3/transfers/{id}/cancel
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasTransfer } from '../types/asaas';

export interface CancelTransferParams {
  apiKey: string;
  id: string;
}

export async function cancelTransfer(params: CancelTransferParams): Promise<AsaasTransfer> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.delete<AsaasTransfer>(`/transfers/${params.id}/cancel`);
}