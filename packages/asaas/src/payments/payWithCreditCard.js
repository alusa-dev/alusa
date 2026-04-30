/**
 * Processar pagamento de uma cobrança existente via cartão de crédito
 *
 * HTTP-only: sem regras de negócio.
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function payWithCreditCard(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.post(`/payments/${params.paymentId}/payWithCreditCard`, params.data);
}
