/**
 * Cria um novo webhook no Asaas
 *
 * POST /v3/webhooks
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasWebhookConfig } from './listWebhooks';

export interface CreateWebhookParams {
  apiKey: string;
  data: {
    name: string;
    url: string;
    email?: string;
    enabled?: boolean;
    interrupted?: boolean;
    apiVersion?: number;
    authToken?: string;
    sendType?: 'NON_SEQUENTIALLY' | 'SEQUENTIALLY';
    events: string[];
  };
}

export async function createWebhook(
  params: CreateWebhookParams,
): Promise<AsaasWebhookConfig> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  return client.post<AsaasWebhookConfig>('/webhooks', params.data);
}
