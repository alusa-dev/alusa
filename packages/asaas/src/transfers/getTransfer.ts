/**
 * Consulta de transferência no Asaas.
 *
 * Endpoint oficial: GET /v3/transfers/{id}
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasTransfer } from '../types/asaas';

export interface GetTransferParams {
  apiKey: string;
  id: string;
}

export async function getTransfer(params: GetTransferParams): Promise<AsaasTransfer> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.get<AsaasTransfer>(`/transfers/${params.id}`);
}