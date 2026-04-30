/**
 * Listagem de transfers no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */
import type { AsaasTransfer } from '../types/asaas';
import type { AsaasListResponse } from '../customers/listCustomers';
export interface ListTransfersParams {
    apiKey: string;
    dateCreatedGe?: string;
    dateCreatedLe?: string;
    transferDateGe?: string;
    transferDateLe?: string;
    type?: string;
    offset?: number;
    limit?: number;
}
export declare function listTransfers(params: ListTransfersParams): Promise<AsaasListResponse<AsaasTransfer>>;
//# sourceMappingURL=listTransfers.d.ts.map