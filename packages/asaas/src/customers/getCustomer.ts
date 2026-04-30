/**
 * Recupera um customer no Asaas
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasCustomer } from '../types/asaas';

export interface GetCustomerParams {
  apiKey: string;
  customerId: string;
  headers?: Record<string, string>;
}

export async function getCustomer(params: GetCustomerParams): Promise<AsaasCustomer> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  return client.get<AsaasCustomer>(`/customers/${params.customerId}`, {
    headers: params.headers,
  });
}
