/**
 * Reativar/ativar assinatura (subscription) no Asaas
 */

import type { AsaasSubscription } from '../types/asaas';
import { updateSubscription } from './updateSubscription';

export interface ActivateSubscriptionParams {
  apiKey: string;
  subscriptionId: string;
}

export async function activateSubscription(
  params: ActivateSubscriptionParams,
): Promise<AsaasSubscription> {
  return updateSubscription({
    apiKey: params.apiKey,
    subscriptionId: params.subscriptionId,
    data: { status: 'ACTIVE' },
  });
}
