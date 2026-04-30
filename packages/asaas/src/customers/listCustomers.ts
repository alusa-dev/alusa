/**
 * Listagem/busca de customers no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasCustomer } from '../types/asaas';

export interface ListCustomersParams {
  apiKey: string;
  search?: string;
  cpfCnpj?: string;
  externalReference?: string;
  offset?: number;
  limit?: number;
}

export interface AsaasListResponse<T> {
  object: 'list';
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: T[];
}

export async function listCustomers(params: ListCustomersParams): Promise<AsaasListResponse<AsaasCustomer>> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  return client.get<AsaasListResponse<AsaasCustomer>>('/customers', {
    params: {
      search: params.search,
      cpfCnpj: params.cpfCnpj,
      externalReference: params.externalReference,
      offset: params.offset,
      limit: params.limit,
    },
  });
}
