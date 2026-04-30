/**
 * Atualização de cobrança (payment) no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function updatePayment(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.put(`/payments/${params.paymentId}`, params.data);
}
