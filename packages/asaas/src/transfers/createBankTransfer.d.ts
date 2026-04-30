/**
 * Criação de transferência bancária (TED) no Asaas
 *
 * ADR-003: Repasse automático + saque controlado
 */
import type { CreateBankTransferInput, AsaasTransfer } from '../types/asaas';
export interface CreateBankTransferParams {
    apiKey: string;
    data: CreateBankTransferInput;
    idempotencyKey?: string;
}
/**
 * Cria uma transferência bancária (TED) no Asaas
 *
 * ⚠️ Esta função executa operação financeira real.
 * Validações de saldo/limite devem ocorrer em packages/finance.
 *
 * @param params.apiKey - API key da subconta
 * @param params.data - Dados da transferência bancária
 * @returns Transfer criada
 */
export declare function createBankTransfer(params: CreateBankTransferParams): Promise<AsaasTransfer>;
//# sourceMappingURL=createBankTransfer.d.ts.map