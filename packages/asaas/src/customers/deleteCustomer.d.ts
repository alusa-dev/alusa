/**
 * Remoção de customer no Asaas (soft delete)
 */
import type { AsaasCustomer } from '../types/asaas';
export interface DeleteCustomerParams {
    apiKey: string;
    customerId: string;
}
/**
 * Remove um customer no Asaas
 *
 * @param params.apiKey - API key da subconta
 * @param params.customerId - ID do customer no Asaas
 * @returns Customer deletado
 */
export declare function deleteCustomer(params: DeleteCustomerParams): Promise<AsaasCustomer>;
//# sourceMappingURL=deleteCustomer.d.ts.map