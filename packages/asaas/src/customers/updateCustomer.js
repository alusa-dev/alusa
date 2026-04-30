/**
 * Atualização de customer no Asaas
 */
import { AsaasHttp } from '../client/AsaasHttp';
/**
 * Atualiza um customer no Asaas
 *
 * @param params.apiKey - API key da subconta
 * @param params.customerId - ID do customer no Asaas
 * @param params.data - Dados para atualizar
 * @returns Customer atualizado
 */
export async function updateCustomer(params) {
    const client = new AsaasHttp({
        apiKey: params.apiKey,
    });
    return client.put(`/customers/${params.customerId}`, params.data);
}
