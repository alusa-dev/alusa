/**
 * Pausar assinatura (subscription) no Asaas
 */
import type { AsaasSubscription } from '../types/asaas';
export interface PauseSubscriptionParams {
    apiKey: string;
    subscriptionId: string;
}
export declare function pauseSubscription(params: PauseSubscriptionParams): Promise<AsaasSubscription>;
//# sourceMappingURL=pauseSubscription.d.ts.map