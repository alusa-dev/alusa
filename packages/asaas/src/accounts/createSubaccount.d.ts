/**
 * Criação de subconta Asaas (white-label)
 *
 * ADR-001: Uma subconta por tenant
 */
import type { CreateSubaccountInput, AsaasSubaccount } from '../types/asaas';
export interface CreateSubaccountParams {
    apiKey: string;
    data: CreateSubaccountInput;
    idempotencyKey?: string;
}
/**
 * Cria uma subconta no Asaas (modelo white-label)
 *
 * @param params.apiKey - API key da conta master
 * @param params.data - Dados da subconta
 * @returns Subconta criada com apiKey e walletId
 */
export declare function createSubaccount(params: CreateSubaccountParams): Promise<AsaasSubaccount>;
//# sourceMappingURL=createSubaccount.d.ts.map