/**
 * Criação de assinatura recorrente no Asaas
 *
 * ADR-006: externalReference obrigatório
 * ADR-009: idempotência
 */
import { AsaasHttp } from '../client/AsaasHttp';
/**
 * Cria uma assinatura recorrente no Asaas
 *
 * @param params.apiKey - API key da subconta
 * @param params.data - Dados da assinatura (deve incluir externalReference)
 * @param params.idempotencyKey - Chave de idempotência
 * @returns Subscription criada
 */
export async function createSubscription(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    const headers = {};
    if (params.idempotencyKey) {
        headers['Idempotency-Key'] = params.idempotencyKey;
    }
    return client.post('/subscriptions', params.data, { headers });
}
