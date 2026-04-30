/**
 * Lista API keys (access tokens) de uma subconta.
 *
 * GET /v3/accounts/{id}/accessTokens
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function listSubaccountAccessTokens(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.get(`/accounts/${params.accountId}/accessTokens`, {
        params: {
            ...(typeof params.limit === 'number' ? { limit: params.limit } : {}),
            ...(typeof params.offset === 'number' ? { offset: params.offset } : {}),
        },
    });
}
