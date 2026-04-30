/**
 * Obter detalhes de uma assinatura (subscription) no Asaas
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasSubscription } from '../types/asaas';

export interface GetSubscriptionParams {
  apiKey: string;
  subscriptionId: string;
}

export async function getSubscription(params: GetSubscriptionParams): Promise<AsaasSubscription> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.get<AsaasSubscription>(`/subscriptions/${params.subscriptionId}`);
}
