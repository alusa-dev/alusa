/**
 * Pausar assinatura (subscription) no Asaas
 */

import type { AsaasSubscription } from '../types/asaas';
import { updateSubscription } from './updateSubscription';

export interface PauseSubscriptionParams {
  apiKey: string;
  subscriptionId: string;
}

export async function pauseSubscription(params: PauseSubscriptionParams): Promise<AsaasSubscription> {
  return updateSubscription({
    apiKey: params.apiKey,
    subscriptionId: params.subscriptionId,
    data: { status: 'INACTIVE' },
  });
}
