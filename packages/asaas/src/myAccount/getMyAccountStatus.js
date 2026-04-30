/**
 * MyAccount Status (KYC geral)
 *
 * Endpoint (whitelabel.md):
 * - GET /v3/myAccount/status/
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function getMyAccountStatus(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    // O Asaas documenta com trailing slash; manter aqui para reduzir chances de 301/308.
    return client.get('/myAccount/status/');
}
