/**
 * Lista webhooks configurados no Asaas
 *
 * GET /v3/webhooks
 */

import { AsaasHttp } from '../client/AsaasHttp';

export interface ListWebhooksParams {
  apiKey: string;
  limit?: number;
  offset?: number;
}

export type AsaasWebhookConfig = {
  object?: 'webhookConfig' | string;
  id: string;
  name?: string;
  url: string;
  email?: string | null;
  enabled?: boolean;
  interrupted?: boolean;
  apiVersion?: number;
  hasAuthToken?: boolean;
  sendType?: 'NON_SEQUENTIALLY' | 'SEQUENTIALLY';
  penalizedRequestsCount?: number;
  events?: string[];
};

export type AsaasWebhookListResponse = {
  object?: 'list' | string;
  hasMore?: boolean;
  totalCount?: number;
  limit?: number;
  offset?: number;
  data: AsaasWebhookConfig[];
};

export async function listWebhooks(params: ListWebhooksParams): Promise<AsaasWebhookListResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  return client.get<AsaasWebhookListResponse>('/webhooks', {
    params: {
      limit: params.limit,
      offset: params.offset,
    },
  });
}
