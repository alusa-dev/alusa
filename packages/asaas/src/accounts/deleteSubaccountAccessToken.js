/**
 * Remove uma API key (access token) de uma subconta.
 *
 * DELETE /v3/accounts/{id}/accessTokens/{accessTokenId}
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function deleteSubaccountAccessToken(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.delete(`/accounts/${params.accountId}/accessTokens/${params.accessTokenId}`);
}
