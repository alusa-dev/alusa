/**
 * Remoção (delete) de cobrança (payment) no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function deletePayment(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.delete(`/payments/${params.paymentId}`);
}
