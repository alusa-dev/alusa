/**
 * Lista API keys (access tokens) de uma subconta.
 *
 * GET /v3/accounts/{id}/accessTokens
 */

import { AsaasHttp } from '../client/AsaasHttp';

export interface ListSubaccountAccessTokensParams {
  apiKey: string;
  accountId: string;
  limit?: number;
  offset?: number;
}

export type AsaasSubaccountAccessTokenItem = {
  object?: string;
  id: string;
  name: string;
  enabled?: boolean;
  expirationDate?: string;
  dateCreated?: string;
  projectedExpirationDateByLackOfUse?: string;
};

export type ListSubaccountAccessTokensResponse = {
  object?: string;
  hasMore?: boolean;
  totalCount?: number;
  limit?: number;
  offset?: number;
  data: AsaasSubaccountAccessTokenItem[];
};

export async function listSubaccountAccessTokens(
  params: ListSubaccountAccessTokensParams,
): Promise<ListSubaccountAccessTokensResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  return client.get<ListSubaccountAccessTokensResponse>(`/accounts/${params.accountId}/accessTokens`, {
    params: {
      ...(typeof params.limit === 'number' ? { limit: params.limit } : {}),
      ...(typeof params.offset === 'number' ? { offset: params.offset } : {}),
    },
  });
}
