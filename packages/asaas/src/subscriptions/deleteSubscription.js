/**
 * Remoção (delete) de assinatura (subscription) no Asaas
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function deleteSubscription(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.delete(`/subscriptions/${params.subscriptionId}`);
}
