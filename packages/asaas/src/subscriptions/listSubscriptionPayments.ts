/**
 * Lista cobranças (payments) geradas por uma assinatura no Asaas
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasPayment } from '../types/asaas';

export type SubscriptionPaymentStatus =
  | 'PENDING'
  | 'RECEIVED'
  | 'CONFIRMED'
  | 'OVERDUE'
  | 'REFUNDED'
  | 'RECEIVED_IN_CASH'
  | 'REFUND_REQUESTED'
  | 'CHARGEBACK_REQUESTED'
  | 'CHARGEBACK_DISPUTE'
  | 'AWAITING_CHARGEBACK_REVERSAL'
  | 'DUNNING_REQUESTED'
  | 'DUNNING_RECEIVED'
  | string;

export interface AsaasListResponse<T> {
  object?: 'list' | string;
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: T[];
}

export interface ListSubscriptionPaymentsParams {
  apiKey: string;
  subscriptionId: string;
  limit?: number;
  offset?: number;
  status?: SubscriptionPaymentStatus;
}

export async function listSubscriptionPayments(
  params: ListSubscriptionPaymentsParams,
): Promise<AsaasListResponse<AsaasPayment>> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  return client.get<AsaasListResponse<AsaasPayment>>(
    `/subscriptions/${params.subscriptionId}/payments`,
    {
      params: {
        limit: params.limit,
        offset: params.offset,
        status: params.status,
      },
    },
  );
}
