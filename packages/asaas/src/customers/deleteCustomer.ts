/**
 * Remoção de customer no Asaas (soft delete)
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasCustomer } from '../types/asaas';

export interface DeleteCustomerParams {
  apiKey: string;
  customerId: string;
}

/**
 * Remove um customer no Asaas
 *
 * @param params.apiKey - API key da subconta
 * @param params.customerId - ID do customer no Asaas
 * @returns Customer deletado
 */
export async function deleteCustomer(params: DeleteCustomerParams): Promise<AsaasCustomer> {
  const client = new AsaasHttp({
    apiKey: params.apiKey,
  });

  return client.delete<AsaasCustomer>(`/customers/${params.customerId}`);
}
