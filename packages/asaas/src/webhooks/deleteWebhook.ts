/**
 * Remove um webhook configurado no Asaas.
 *
 * DELETE /v3/webhooks/{id}
 */

import { AsaasHttp } from '../client/AsaasHttp';

export interface DeleteWebhookParams {
  apiKey: string;
  webhookId: string;
}

export async function deleteWebhook(params: DeleteWebhookParams): Promise<void> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  await client.delete(`/webhooks/${params.webhookId}`);
}
