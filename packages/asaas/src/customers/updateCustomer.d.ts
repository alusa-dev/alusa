/**
 * Atualização de customer no Asaas
 */
import type { AsaasCustomer } from '../types/asaas';
export interface UpdateCustomerParams {
    apiKey: string;
    customerId: string;
    data: {
        name?: string;
        email?: string;
        phone?: string;
        mobilePhone?: string;
        address?: string;
        addressNumber?: string;
        complement?: string;
        province?: string;
        postalCode?: string;
        externalReference?: string;
        notificationDisabled?: boolean;
    };
}
/**
 * Atualiza um customer no Asaas
 *
 * @param params.apiKey - API key da subconta
 * @param params.customerId - ID do customer no Asaas
 * @param params.data - Dados para atualizar
 * @returns Customer atualizado
 */
export declare function updateCustomer(params: UpdateCustomerParams): Promise<AsaasCustomer>;
//# sourceMappingURL=updateCustomer.d.ts.map