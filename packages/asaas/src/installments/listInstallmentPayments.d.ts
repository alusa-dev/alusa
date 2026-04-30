/**
 * Listar payments de um carnê/parcelamento (installment) no Asaas
 */
import type { AsaasPayment } from '../types/asaas';
export interface AsaasListResponse<T> {
    object: 'list';
    hasMore: boolean;
    totalCount: number;
    limit: number;
    offset: number;
    data: T[];
}
export interface ListInstallmentPaymentsParams {
    apiKey: string;
    installmentId: string;
    status?: 'PENDING' | 'RECEIVED' | 'CONFIRMED' | 'OVERDUE' | 'REFUNDED' | 'RECEIVED_IN_CASH' | 'REFUND_REQUESTED' | 'REFUND_IN_PROGRESS' | 'CHARGEBACK_REQUESTED' | 'CHARGEBACK_DISPUTE' | 'AWAITING_CHARGEBACK_REVERSAL' | 'DUNNING_REQUESTED' | 'DUNNING_RECEIVED' | 'AWAITING_RISK_ANALYSIS';
    offset?: number;
    limit?: number;
}
export declare function listInstallmentPayments(params: ListInstallmentPaymentsParams): Promise<AsaasListResponse<AsaasPayment>>;
//# sourceMappingURL=listInstallmentPayments.d.ts.map