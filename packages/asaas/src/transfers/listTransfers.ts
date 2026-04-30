/**
 * Listagem de transfers no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasTransfer } from '../types/asaas';
import type { AsaasListResponse } from '../customers/listCustomers';

export interface ListTransfersParams {
  apiKey: string;

  dateCreatedGe?: string;
  dateCreatedLe?: string;
  transferDateGe?: string;
  transferDateLe?: string;
  type?: string;

  offset?: number;
  limit?: number;
}

export async function listTransfers(params: ListTransfersParams): Promise<AsaasListResponse<AsaasTransfer>> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  return client.get<AsaasListResponse<AsaasTransfer>>('/transfers', {
    params: {
      'dateCreated[ge]': params.dateCreatedGe,
      'dateCreated[le]': params.dateCreatedLe,
      'transferDate[ge]': params.transferDateGe,
      'transferDate[le]': params.transferDateLe,
      type: params.type,
      offset: params.offset,
      limit: params.limit,
    },
  });
}
