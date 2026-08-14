/**
 * Recupera uma configuração de webhook específica no Asaas.
 *
 * GET /v3/webhooks/{id}
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasWebhookConfig } from './listWebhooks';

export interface GetWebhookParams {
  apiKey: string;
  webhookId: string;
}

export async function getWebhook(params: GetWebhookParams): Promise<AsaasWebhookConfig> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.get<AsaasWebhookConfig>(`/webhooks/${params.webhookId}`);
}
