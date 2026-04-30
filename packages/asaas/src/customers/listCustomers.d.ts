/**
 * Listagem/busca de customers no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */
import type { AsaasCustomer } from '../types/asaas';
export interface ListCustomersParams {
    apiKey: string;
    search?: string;
    cpfCnpj?: string;
    externalReference?: string;
    offset?: number;
    limit?: number;
}
export interface AsaasListResponse<T> {
    object: 'list';
    hasMore: boolean;
    totalCount: number;
    limit: number;
    offset: number;
    data: T[];
}
export declare function listCustomers(params: ListCustomersParams): Promise<AsaasListResponse<AsaasCustomer>>;
//# sourceMappingURL=listCustomers.d.ts.map