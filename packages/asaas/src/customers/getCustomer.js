/**
 * Recupera um customer no Asaas
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function getCustomer(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.get(`/customers/${params.customerId}`, {
        headers: params.headers,
    });
}
