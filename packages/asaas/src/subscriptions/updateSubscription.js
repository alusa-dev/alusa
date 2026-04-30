/**
 * Atualização de assinatura (subscription) no Asaas
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function updateSubscription(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.put(`/subscriptions/${params.subscriptionId}`, params.data);
}
