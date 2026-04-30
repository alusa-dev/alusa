/**
 * Criação de subconta Asaas (white-label)
 *
 * ADR-001: Uma subconta por tenant
 */
import { AsaasHttp } from '../client/AsaasHttp';
/**
 * Cria uma subconta no Asaas (modelo white-label)
 *
 * @param params.apiKey - API key da conta master
 * @param params.data - Dados da subconta
 * @returns Subconta criada com apiKey e walletId
 */
export async function createSubaccount(params) {
    const client = new AsaasHttp({
        apiKey: params.apiKey,
    });
    const headers = {};
    if (params.idempotencyKey) {
        headers['Idempotency-Key'] = params.idempotencyKey;
    }
    return client.post('/accounts', params.data, { headers });
}
