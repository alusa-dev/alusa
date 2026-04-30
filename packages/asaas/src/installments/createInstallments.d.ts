/**
 * Criação de parcelamento/carnê (installments) no Asaas
 *
 * Endpoint oficial: POST /v3/installments
 */
import type { AsaasInstallment, BillingType } from '../types/asaas';
export interface CreateInstallmentsParams {
    apiKey: string;
    customer: string;
    value: number;
    dueDate: string;
    installmentCount: number;
    billingType: BillingType;
    description?: string;
    idempotencyKey?: string;
}
/**
 * Cria um parcelamento no Asaas
 *
 * @param params.apiKey - API key da subconta
 * @param params.customer - ID do customer
 * @param params.installmentCount - Número de parcelas
 * @param params.value - Valor de cada parcela
 * @param params.idempotencyKey - Chave de idempotência
 * @returns Installment criado
 */
export declare function createInstallments(params: CreateInstallmentsParams): Promise<AsaasInstallment>;
//# sourceMappingURL=createInstallments.d.ts.map