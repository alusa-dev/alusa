/**
 * Pausar assinatura (subscription) no Asaas
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function pauseSubscription(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.post(`/subscriptions/${params.subscriptionId}/pause`);
}
