/**
 * Lista assinaturas (subscriptions) no Asaas
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasSubscription, BillingType, SubscriptionStatus } from '../types/asaas';

export interface AsaasListResponse<T> {
  object?: 'list' | string;
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: T[];
}

export interface ListSubscriptionsParams {
  apiKey: string;
  offset?: number;
  limit?: number;
  customer?: string;
  customerGroupName?: string;
  billingType?: BillingType;
  status?: SubscriptionStatus;
  deletedOnly?: boolean;
  includeDeleted?: boolean;
  externalReference?: string;
  order?: string;
  sort?: string;
}

export async function listSubscriptions(
  params: ListSubscriptionsParams,
): Promise<AsaasListResponse<AsaasSubscription>> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  return client.get<AsaasListResponse<AsaasSubscription>>('/subscriptions', {
    params: {
      offset: params.offset,
      limit: params.limit,
      customer: params.customer,
      customerGroupName: params.customerGroupName,
      billingType: params.billingType,
      status: params.status,
      deletedOnly: params.deletedOnly ? 'true' : undefined,
      includeDeleted: params.includeDeleted ? 'true' : undefined,
      externalReference: params.externalReference,
      order: params.order,
      sort: params.sort,
    },
  });
}
