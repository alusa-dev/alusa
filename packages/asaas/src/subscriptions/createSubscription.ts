/**
 * Criação de assinatura recorrente no Asaas
 * 
 * ADR-006: externalReference obrigatório
 * ADR-009: idempotência
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { CreateSubscriptionInput, AsaasSubscription } from '../types/asaas';

export interface CreateSubscriptionParams {
  apiKey: string;
  data: CreateSubscriptionInput;
  idempotencyKey?: string;
}

/**
 * Cria uma assinatura recorrente no Asaas
 * 
 * @param params.apiKey - API key da subconta
 * @param params.data - Dados da assinatura (deve incluir externalReference)
 * @param params.idempotencyKey - Chave de idempotência
 * @returns Subscription criada
 */
export async function createSubscription(
  params: CreateSubscriptionParams,
): Promise<AsaasSubscription> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  const headers: Record<string, string> = {};
  if (params.idempotencyKey) {
    headers['Idempotency-Key'] = params.idempotencyKey;
  }

  return client.post<AsaasSubscription>('/subscriptions', params.data, { headers });
}
