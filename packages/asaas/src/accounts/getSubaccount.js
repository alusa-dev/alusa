/**
 * Recupera uma subconta Asaas (white-label)
 *
 * GET /v3/accounts/{id}
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function getSubaccount(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.get(`/accounts/${params.accountId}`);
}
