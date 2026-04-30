/**
 * MyAccount Commercial Info
 *
 * Endpoint (spec):
 * - GET /v3/myAccount/commercialInfo/
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function getMyAccountCommercialInfo(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    // O Asaas documenta com trailing slash; manter aqui para reduzir chances de 301/308.
    return client.get('/myAccount/commercialInfo/');
}
export async function updateMyAccountCommercialInfo(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    // O Asaas documenta com trailing slash; manter aqui para reduzir chances de 301/308.
    return client.post('/myAccount/commercialInfo/', params.data);
}
