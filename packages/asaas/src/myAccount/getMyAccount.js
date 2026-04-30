/**
 * MyAccount
 *
 * Endpoint (spec):
 * - GET /v3/myAccount
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function getMyAccount(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.get('/myAccount');
}
