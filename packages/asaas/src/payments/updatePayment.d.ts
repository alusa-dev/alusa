/**
 * Atualização de cobrança (payment) no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */
import type { AsaasPayment, CreatePaymentInput } from '../types/asaas';
export interface UpdatePaymentParams {
    apiKey: string;
    paymentId: string;
    data: Partial<CreatePaymentInput>;
}
export declare function updatePayment(params: UpdatePaymentParams): Promise<AsaasPayment>;
//# sourceMappingURL=updatePayment.d.ts.map