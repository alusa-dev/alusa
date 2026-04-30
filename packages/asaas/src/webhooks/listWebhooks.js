/**
 * Lista webhooks configurados no Asaas
 *
 * GET /v3/webhooks
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function listWebhooks(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.get('/webhooks', {
        params: {
            limit: params.limit,
            offset: params.offset,
        },
    });
}
