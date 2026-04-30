/**
 * Reativar/ativar assinatura (subscription) no Asaas
 */
import type { AsaasSubscription } from '../types/asaas';
export interface ActivateSubscriptionParams {
    apiKey: string;
    subscriptionId: string;
}
export declare function activateSubscription(params: ActivateSubscriptionParams): Promise<AsaasSubscription>;
//# sourceMappingURL=activateSubscription.d.ts.map