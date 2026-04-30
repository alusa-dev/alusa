/**
 * Criação de assinatura recorrente no Asaas
 *
 * ADR-006: externalReference obrigatório
 * ADR-009: idempotência
 */
import type { CreateSubscriptionInput, AsaasSubscription } from '../types/asaas';
export interface CreateSubscriptionParams {
    apiKey: string;
    data: CreateSubscriptionInput;
    idempotencyKey?: string;
}
/**
 * Cria uma assinatura recorrente no Asaas
 *
 * @param params.apiKey - API key da subconta
 * @param params.data - Dados da assinatura (deve incluir externalReference)
 * @param params.idempotencyKey - Chave de idempotência
 * @returns Subscription criada
 */
export declare function createSubscription(params: CreateSubscriptionParams): Promise<AsaasSubscription>;
//# sourceMappingURL=createSubscription.d.ts.map