/**
 * Desfaz confirmação de recebimento em dinheiro no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */
import { AsaasHttp } from '../client/AsaasHttp';
/**
 * Desfaz o recebimento em dinheiro de uma cobrança.
 * O status do pagamento volta para o estado anterior (PENDING ou OVERDUE).
 *
 * @param params.apiKey - API key da subconta
 * @param params.paymentId - ID do payment no Asaas
 * @returns Payment atualizado
 */
export async function undoReceivedInCash(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.post(`/payments/${params.paymentId}/undoReceivedInCash`, {});
}
