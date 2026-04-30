/**
 * Atualização de subconta Asaas (white-label)
 *
 * ADR-001: Uma subconta por tenant
 */
import type { CreateSubaccountInput, AsaasSubaccount } from '../types/asaas';
export interface UpdateSubaccountParams {
    apiKey: string;
    accountId: string;
    data: Partial<CreateSubaccountInput>;
}
export declare function updateSubaccount(params: UpdateSubaccountParams): Promise<AsaasSubaccount>;
//# sourceMappingURL=updateSubaccount.d.ts.map