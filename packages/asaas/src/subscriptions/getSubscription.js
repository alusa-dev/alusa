/**
 * Obter detalhes de uma assinatura (subscription) no Asaas
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function getSubscription(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.get(`/subscriptions/${params.subscriptionId}`);
}
