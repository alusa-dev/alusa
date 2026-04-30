/**
 * Lista webhooks configurados no Asaas
 *
 * GET /v3/webhooks
 */
export interface ListWebhooksParams {
    apiKey: string;
    limit?: number;
    offset?: number;
}
export type AsaasWebhookConfig = {
    object?: 'webhookConfig' | string;
    id: string;
    url: string;
    email?: string | null;
    enabled?: boolean;
    interrupted?: boolean;
    apiVersion?: number;
};
export type AsaasWebhookListResponse = {
    object?: 'list' | string;
    hasMore?: boolean;
    totalCount?: number;
    limit?: number;
    offset?: number;
    data: AsaasWebhookConfig[];
};
export declare function listWebhooks(params: ListWebhooksParams): Promise<AsaasWebhookListResponse>;
//# sourceMappingURL=listWebhooks.d.ts.map