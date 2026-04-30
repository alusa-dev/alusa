/**
 * Criação de parcelamento/carnê (installments) no Asaas
 *
 * Endpoint oficial: POST /v3/installments
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function createInstallment(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    const headers = {};
    if (params.idempotencyKey) {
        headers['Idempotency-Key'] = params.idempotencyKey;
    }
    return client.post('/installments', params.data, { headers });
}
