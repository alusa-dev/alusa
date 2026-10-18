/**
 * Criação de subconta Asaas (white-label)
 * 
 * ADR-001: Uma subconta por tenant
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { CreateSubaccountInput, AsaasSubaccount } from '../types/asaas';

export interface CreateSubaccountParams {
  apiKey: string;
  data: CreateSubaccountInput;
  idempotencyKey?: string;
}

/**
 * Cria uma subconta no Asaas (modelo white-label)
 * 
 * @param params.apiKey - API key da conta master
 * @param params.data - Dados da subconta
 * @returns Subconta criada com accessToken.apiKey e walletId
 */
export async function createSubaccount(
  params: CreateSubaccountParams,
): Promise<AsaasSubaccount> {
  const client = new AsaasHttp({
    apiKey: params.apiKey,
  });

  // idempotencyKey is an internal operation key; Asaas does not document
  // provider-side deduplication for this endpoint.
  return client.post<AsaasSubaccount>('/accounts', params.data);
}
