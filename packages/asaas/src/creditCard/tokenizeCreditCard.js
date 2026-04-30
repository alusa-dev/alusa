/**
 * Tokenização de cartão de crédito no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function tokenizeCreditCard(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.post('/creditCard/tokenize', params.data);
}
