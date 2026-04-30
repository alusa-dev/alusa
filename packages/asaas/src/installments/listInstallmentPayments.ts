/**
 * Listar payments de um carnê/parcelamento (installment) no Asaas
 */

import { AsaasHttp } from '../client/AsaasHttp';
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
  status?:
    | 'PENDING'
    | 'RECEIVED'
    | 'CONFIRMED'
    | 'OVERDUE'
    | 'REFUNDED'
    | 'RECEIVED_IN_CASH'
    | 'REFUND_REQUESTED'
    | 'REFUND_IN_PROGRESS'
    | 'CHARGEBACK_REQUESTED'
    | 'CHARGEBACK_DISPUTE'
    | 'AWAITING_CHARGEBACK_REVERSAL'
    | 'DUNNING_REQUESTED'
    | 'DUNNING_RECEIVED'
    | 'AWAITING_RISK_ANALYSIS';
  offset?: number;
  limit?: number;
}

export async function listInstallmentPayments(
  params: ListInstallmentPaymentsParams
): Promise<AsaasListResponse<AsaasPayment>> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  return client.get<AsaasListResponse<AsaasPayment>>(`/installments/${params.installmentId}/payments`, {
    params: {
      status: params.status,
      offset: params.offset,
      limit: params.limit,
    },
  });
}
