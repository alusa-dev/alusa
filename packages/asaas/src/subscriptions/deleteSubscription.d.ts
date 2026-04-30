/**
 * Remoção (delete) de assinatura (subscription) no Asaas
 */
import type { AsaasSubscription } from '../types/asaas';
export interface DeleteSubscriptionParams {
    apiKey: string;
    subscriptionId: string;
}
export declare function deleteSubscription(params: DeleteSubscriptionParams): Promise<AsaasSubscription>;
//# sourceMappingURL=deleteSubscription.d.ts.map