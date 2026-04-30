/**
 * Confirma recebimento em dinheiro (receiveInCash) no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function receiveInCash(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.post(`/payments/${params.paymentId}/receiveInCash`, {
        paymentDate: params.paymentDate,
        value: params.value,
        ...(typeof params.notifyCustomer === 'boolean' ? { notifyCustomer: params.notifyCustomer } : {}),
    });
}
