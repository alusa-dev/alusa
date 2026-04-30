/**
 * Buscar detalhes de um carnê/parcelamento (installment) no Asaas
 */
import type { AsaasInstallment } from '../types/asaas';
export interface GetInstallmentParams {
    apiKey: string;
    installmentId: string;
}
export declare function getInstallment(params: GetInstallmentParams): Promise<AsaasInstallment>;
//# sourceMappingURL=getInstallment.d.ts.map