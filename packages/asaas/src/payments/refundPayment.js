/**
 * Estorno de cobrança (payment) no Asaas
 */
import { AsaasHttp } from '../client/AsaasHttp';
/**
 * Estorna uma cobrança (total ou parcial)
 *
 * @param params.apiKey - API key da subconta
 * @param params.paymentId - ID do payment no Asaas
 * @param params.value - Valor a estornar (opcional, default = total)
 * @param params.description - Descrição do estorno
 * @returns Payment estornado
 */
export async function refundPayment(params) {
    const client = new AsaasHttp({
        apiKey: params.apiKey,
    });
    const body = {};
    if (params.value)
        body.value = params.value;
    if (params.description)
        body.description = params.description;
    return client.post(`/payments/${params.paymentId}/refund`, body);
}
