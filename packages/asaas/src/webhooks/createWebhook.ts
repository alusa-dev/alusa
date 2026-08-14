/**
 * Cria um novo webhook no Asaas
 *
 * POST /v3/webhooks
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasWebhookEventType, AsaasWebhookSendType } from '../types/asaas';
import type { AsaasWebhookConfig } from './listWebhooks';

export interface CreateWebhookParams {
  apiKey: string;
  data: {
    name: string;
    url: string;
    email: string;
    enabled: boolean;
    interrupted: boolean;
    apiVersion: 3;
    authToken: string;
    sendType: AsaasWebhookSendType;
    events: AsaasWebhookEventType[];
  };
}

export async function createWebhook(
  params: CreateWebhookParams,
): Promise<AsaasWebhookConfig> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  return client.post<AsaasWebhookConfig>('/webhooks', params.data);
}
