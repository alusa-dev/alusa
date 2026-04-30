/**
 * Reativar/ativar assinatura (subscription) no Asaas
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function activateSubscription(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.post(`/subscriptions/${params.subscriptionId}/activate`);
}
