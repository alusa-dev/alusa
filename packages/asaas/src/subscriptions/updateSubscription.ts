/**
 * Atualização de assinatura (subscription) no Asaas
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasSubscription, UpdateSubscriptionInput } from '../types/asaas';

export interface UpdateSubscriptionParams {
  apiKey: string;
  subscriptionId: string;
  data: UpdateSubscriptionInput;
}

export async function updateSubscription(
  params: UpdateSubscriptionParams,
): Promise<AsaasSubscription> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.put<AsaasSubscription>(`/subscriptions/${params.subscriptionId}`, params.data);
}
