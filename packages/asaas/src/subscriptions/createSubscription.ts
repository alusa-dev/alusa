/**
 * Criação de assinatura recorrente no Asaas
 * 
 * ADR-006: externalReference obrigatório
 * ADR-009: idempotência controlada pelo protocolo local de operações
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
 * @param params.idempotencyKey - Identificador local da operação; não é uma garantia remota do Asaas
 * @returns Subscription criada
 */
export async function createSubscription(
  params: CreateSubscriptionParams,
): Promise<AsaasSubscription> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  // The local operation key is reconciled through externalReference; the
  // endpoint does not document provider-side Idempotency-Key support.
  return client.post<AsaasSubscription>('/subscriptions', params.data);
}
