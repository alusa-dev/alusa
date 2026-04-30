/**
 * Criação de cobrança (payment) no Asaas
 *
 * ADR-006: externalReference para rastreabilidade
 * ADR-009: idempotência obrigatória
 */
import type { CreatePaymentInput, AsaasPayment } from '../types/asaas';
export interface CreatePaymentParams {
    apiKey: string;
    data: CreatePaymentInput;
    idempotencyKey?: string;
}
/**
 * Cria uma cobrança (payment) no Asaas
 *
 * @param params.apiKey - API key da subconta
 * @param params.data - Dados da cobrança (deve incluir externalReference)
 * @param params.idempotencyKey - Chave de idempotência
 * @returns Payment criado
 */
export declare function createPayment(params: CreatePaymentParams): Promise<AsaasPayment>;
//# sourceMappingURL=createPayment.d.ts.map