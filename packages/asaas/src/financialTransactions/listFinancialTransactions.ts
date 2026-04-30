/**
 * Extrato (financialTransactions) no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasFinancialTransaction } from '../types/asaas';
import type { AsaasListResponse } from '../customers/listCustomers';

export interface ListFinancialTransactionsParams {
  apiKey: string;
  offset?: number;
  limit?: number;
  startDate?: string; // YYYY-MM-DD
  finishDate?: string; // YYYY-MM-DD
  order?: 'asc' | 'desc';
}

export async function listFinancialTransactions(
  params: ListFinancialTransactionsParams,
): Promise<AsaasListResponse<AsaasFinancialTransaction>> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  return client.get<AsaasListResponse<AsaasFinancialTransaction>>('/financialTransactions', {
    params: {
      offset: params.offset,
      limit: params.limit,
      startDate: params.startDate,
      finishDate: params.finishDate,
      order: params.order,
    },
  });
}
