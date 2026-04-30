/**
 * Criação de transferência PIX no Asaas
 *
 * ADR-003: Repasse automático + saque controlado
 * ADR-009: Segurança e auditoria
 */
import type { CreatePixTransferInput, AsaasTransfer } from '../types/asaas';
export interface CreatePixTransferParams {
    apiKey: string;
    data: CreatePixTransferInput;
    idempotencyKey?: string;
}
/**
 * Cria uma transferência PIX no Asaas
 *
 * ⚠️ Esta função executa operação financeira real.
 * Validações de saldo/limite devem ocorrer em packages/finance.
 *
 * @param params.apiKey - API key da subconta
 * @param params.data - Dados da transferência PIX
 * @returns Transfer criada
 */
export declare function createPixTransfer(params: CreatePixTransferParams): Promise<AsaasTransfer>;
//# sourceMappingURL=createPixTransfer.d.ts.map