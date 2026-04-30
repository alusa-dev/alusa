/**
 * Atualização de assinatura (subscription) no Asaas
 */
import type { AsaasSubscription, CreateSubscriptionInput } from '../types/asaas';
export interface UpdateSubscriptionParams {
    apiKey: string;
    subscriptionId: string;
    data: Partial<CreateSubscriptionInput>;
}
export declare function updateSubscription(params: UpdateSubscriptionParams): Promise<AsaasSubscription>;
//# sourceMappingURL=updateSubscription.d.ts.map