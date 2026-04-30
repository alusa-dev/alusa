/**
 * Obtém informações de cobrança (billing info) de um pagamento no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */
import { AsaasHttp } from '../client/AsaasHttp';
/**
 * Obtém informações de cobrança (QR Code Pix, boleto, etc.)
 *
 * @param params.apiKey - API key da subconta
 * @param params.paymentId - ID do payment no Asaas
 * @returns Informações de cobrança
 */
export async function getBillingInfo(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.get(`/payments/${params.paymentId}/billingInfo`);
}
