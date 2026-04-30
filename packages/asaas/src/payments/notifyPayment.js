/**
 * Envio de notificações nativas do Asaas (email/sms/whatsapp)
 *
 * HTTP-only: sem regras de negócio.
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function notifyPayment(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    // Endpoint e payload conforme API do Asaas.
    return client.post(`/payments/${params.paymentId}/notifications`, {
        notificationType: params.tipo,
    });
}
