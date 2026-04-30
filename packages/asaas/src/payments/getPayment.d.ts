/**
 * Obter detalhes de um payment no Asaas
 */
import type { AsaasPayment } from '../types/asaas';
export interface GetPaymentParams {
    apiKey: string;
    paymentId: string;
}
export declare function getPayment(params: GetPaymentParams): Promise<AsaasPayment>;
//# sourceMappingURL=getPayment.d.ts.map