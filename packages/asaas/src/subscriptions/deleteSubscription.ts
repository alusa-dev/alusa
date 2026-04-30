/**
 * Remoção (delete) de assinatura (subscription) no Asaas
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasSubscription } from '../types/asaas';

export interface DeleteSubscriptionParams {
  apiKey: string;
  subscriptionId: string;
}

export async function deleteSubscription(params: DeleteSubscriptionParams): Promise<AsaasSubscription> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.delete<AsaasSubscription>(`/subscriptions/${params.subscriptionId}`);
}
