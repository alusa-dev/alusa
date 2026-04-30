/**
 * Obter detalhes de uma assinatura (subscription) no Asaas
 */
import type { AsaasSubscription } from '../types/asaas';
export interface GetSubscriptionParams {
    apiKey: string;
    subscriptionId: string;
}
export declare function getSubscription(params: GetSubscriptionParams): Promise<AsaasSubscription>;
//# sourceMappingURL=getSubscription.d.ts.map