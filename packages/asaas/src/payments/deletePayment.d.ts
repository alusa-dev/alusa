/**
 * Remoção (delete) de cobrança (payment) no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */
import type { AsaasPayment } from '../types/asaas';
export interface DeletePaymentParams {
    apiKey: string;
    paymentId: string;
}
export declare function deletePayment(params: DeletePaymentParams): Promise<AsaasPayment>;
//# sourceMappingURL=deletePayment.d.ts.map