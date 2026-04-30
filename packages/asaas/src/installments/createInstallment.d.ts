/**
 * Criação de parcelamento/carnê (installments) no Asaas
 *
 * Endpoint oficial: POST /v3/installments
 */
import type { AsaasInstallment, CreateInstallmentInput } from '../types/asaas';
export interface CreateInstallmentParams {
    apiKey: string;
    data: CreateInstallmentInput;
    idempotencyKey?: string;
}
export declare function createInstallment(params: CreateInstallmentParams): Promise<AsaasInstallment>;
//# sourceMappingURL=createInstallment.d.ts.map