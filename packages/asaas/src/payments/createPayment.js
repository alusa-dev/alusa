/**
 * Criação de cobrança (payment) no Asaas
 *
 * ADR-006: externalReference para rastreabilidade
 * ADR-009: idempotência obrigatória
 */
import { AsaasHttp } from '../client/AsaasHttp';
/**
 * Cria uma cobrança (payment) no Asaas
 *
 * @param params.apiKey - API key da subconta
 * @param params.data - Dados da cobrança (deve incluir externalReference)
 * @param params.idempotencyKey - Chave de idempotência
 * @returns Payment criado
 */
export async function createPayment(params) {
    const client = new AsaasHttp({
        apiKey: params.apiKey,
    });
    const headers = {};
    if (params.idempotencyKey) {
        headers['Idempotency-Key'] = params.idempotencyKey;
    }
    return client.post('/payments', params.data, { headers });
}
