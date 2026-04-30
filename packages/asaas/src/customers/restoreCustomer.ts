/**
 * Restauração de customer removido no Asaas (undo soft delete)
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasCustomer } from '../types/asaas';

export interface RestoreCustomerParams {
  apiKey: string;
  customerId: string;
}

/**
 * Restaura um customer removido (soft delete) no Asaas.
 */
export async function restoreCustomer(params: RestoreCustomerParams): Promise<AsaasCustomer> {
  const client = new AsaasHttp({
    apiKey: params.apiKey,
  });

  return client.post<AsaasCustomer>(`/customers/${params.customerId}/restore`, {});
}
