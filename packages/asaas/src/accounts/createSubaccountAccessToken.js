/**
 * Cria uma API key (access token) para uma subconta.
 *
 * POST /v3/accounts/{id}/accessTokens
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function createSubaccountAccessToken(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.post(`/accounts/${params.accountId}/accessTokens`, {
        name: params.name,
        ...(typeof params.enabled === 'boolean' ? { enabled: params.enabled } : {}),
        ...(typeof params.expirationDate === 'string' ? { expirationDate: params.expirationDate } : {}),
    });
}
