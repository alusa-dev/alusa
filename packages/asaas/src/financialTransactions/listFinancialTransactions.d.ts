/**
 * Extrato (financialTransactions) no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */
import type { AsaasFinancialTransaction } from '../types/asaas';
import type { AsaasListResponse } from '../customers/listCustomers';
export interface ListFinancialTransactionsParams {
    apiKey: string;
    offset?: number;
    limit?: number;
    startDate?: string;
    finishDate?: string;
    order?: 'asc' | 'desc';
}
export declare function listFinancialTransactions(params: ListFinancialTransactionsParams): Promise<AsaasListResponse<AsaasFinancialTransaction>>;
//# sourceMappingURL=listFinancialTransactions.d.ts.map