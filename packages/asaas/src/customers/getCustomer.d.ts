/**
 * Recupera um customer no Asaas
 */
import type { AsaasCustomer } from '../types/asaas';
export interface GetCustomerParams {
    apiKey: string;
    customerId: string;
    headers?: Record<string, string>;
}
export declare function getCustomer(params: GetCustomerParams): Promise<AsaasCustomer>;
//# sourceMappingURL=getCustomer.d.ts.map