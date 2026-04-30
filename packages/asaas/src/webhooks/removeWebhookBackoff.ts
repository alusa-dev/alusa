/**
 * Remove penalização de webhook no Asaas
 *
 * POST /v3/webhooks/{id}/removeBackoff
 *
 * Quando um webhook atinge 15 falhas consecutivas, o Asaas marca
 * `interrupted=true` e para de enviar eventos. Esta chamada remove
 * a penalização e reativa a entrega.
 */

import { AsaasHttp } from '../client/AsaasHttp';

export interface RemoveWebhookBackoffParams {
  apiKey: string;
  webhookId: string;
}

export type RemoveWebhookBackoffResponse = {
  object?: 'webhookConfig' | string;
  id: string;
  url: string;
  enabled?: boolean;
  interrupted?: boolean;
  apiVersion?: number;
};

export async function removeWebhookBackoff(
  params: RemoveWebhookBackoffParams,
): Promise<RemoveWebhookBackoffResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  return client.post<RemoveWebhookBackoffResponse>(
    `/webhooks/${params.webhookId}/removeBackoff`,
  );
}
