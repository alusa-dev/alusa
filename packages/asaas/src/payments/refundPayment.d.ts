/**
 * Estorno de cobrança (payment) no Asaas
 */
import type { AsaasPayment } from '../types/asaas';
export interface RefundPaymentParams {
    apiKey: string;
    paymentId: string;
    value?: number;
    description?: string;
}
/**
 * Estorna uma cobrança (total ou parcial)
 *
 * @param params.apiKey - API key da subconta
 * @param params.paymentId - ID do payment no Asaas
 * @param params.value - Valor a estornar (opcional, default = total)
 * @param params.description - Descrição do estorno
 * @returns Payment estornado
 */
export declare function refundPayment(params: RefundPaymentParams): Promise<AsaasPayment>;
//# sourceMappingURL=refundPayment.d.ts.map