/**
 * Criação de customer no Asaas
 *
 * ADR-006: externalReference obrigatório para rastreabilidade
 */
import { AsaasHttp } from '../client/AsaasHttp';
/**
 * Cria um customer no Asaas
 *
 * @param params.apiKey - API key da subconta
 * @param params.data - Dados do customer (deve incluir externalReference)
 * @param params.idempotencyKey - Chave de idempotência (ADR-009)
 * @returns Customer criado
 */
export async function createCustomer(params) {
    const client = new AsaasHttp({
        apiKey: params.apiKey,
    });
    const headers = {};
    if (params.idempotencyKey) {
        headers['Idempotency-Key'] = params.idempotencyKey;
    }
    return client.post('/customers', params.data, { headers });
}
