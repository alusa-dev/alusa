/**
 * Obter detalhes de um payment no Asaas
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function getPayment(params) {
    const client = new AsaasHttp({
        apiKey: params.apiKey,
    });
    return client.get(`/payments/${params.paymentId}`);
}
