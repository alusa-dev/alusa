/**
 * Criação de customer no Asaas
 * 
 * ADR-006: externalReference obrigatório para rastreabilidade
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { CreateCustomerInput, AsaasCustomer } from '../types/asaas';

export interface CreateCustomerParams {
  apiKey: string;
  data: CreateCustomerInput;
  idempotencyKey?: string;
}

/**
 * Cria um customer no Asaas
 * 
 * @param params.apiKey - API key da subconta
 * @param params.data - Dados do customer (deve incluir externalReference)
 * @param params.idempotencyKey - Identificador local da operação; não é uma garantia remota do Asaas
 * @returns Customer criado
 */
export async function createCustomer(params: CreateCustomerParams): Promise<AsaasCustomer> {
  const client = new AsaasHttp({
    apiKey: params.apiKey,
  });

  // Keep the local key in the outbound operation ledger. The Asaas endpoint
  // does not document Idempotency-Key support, so recovery uses externalReference.
  return client.post<AsaasCustomer>('/customers', params.data);
}
