/**
 * Atualiza um webhook configurado no Asaas.
 *
 * PUT /v3/webhooks/{id}
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasWebhookConfigInput } from '../types/asaas';
import type { AsaasWebhookConfig } from './listWebhooks';

export interface UpdateWebhookParams {
  apiKey: string;
  webhookId: string;
  data: {
    name?: AsaasWebhookConfigInput['name'];
    url: AsaasWebhookConfigInput['url'];
    email?: AsaasWebhookConfigInput['email'];
    enabled?: AsaasWebhookConfigInput['enabled'];
    interrupted?: AsaasWebhookConfigInput['interrupted'];
    authToken?: AsaasWebhookConfigInput['authToken'];
    sendType?: AsaasWebhookConfigInput['sendType'];
    events?: AsaasWebhookConfigInput['events'];
  };
}

export async function updateWebhook(
  params: UpdateWebhookParams,
): Promise<AsaasWebhookConfig> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  return client.put<AsaasWebhookConfig>(`/webhooks/${params.webhookId}`, params.data);
}
