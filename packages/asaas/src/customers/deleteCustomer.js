/**
 * Remoção de customer no Asaas (soft delete)
 */
import { AsaasHttp } from '../client/AsaasHttp';
/**
 * Remove um customer no Asaas
 *
 * @param params.apiKey - API key da subconta
 * @param params.customerId - ID do customer no Asaas
 * @returns Customer deletado
 */
export async function deleteCustomer(params) {
    const client = new AsaasHttp({
        apiKey: params.apiKey,
    });
    return client.delete(`/customers/${params.customerId}`);
}
