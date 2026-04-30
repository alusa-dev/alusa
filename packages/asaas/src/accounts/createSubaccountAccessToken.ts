/**
 * Cria uma API key (access token) para uma subconta.
 *
 * POST /v3/accounts/{id}/accessTokens
 */

import { AsaasHttp } from '../client/AsaasHttp';

export interface CreateSubaccountAccessTokenParams {
  apiKey: string;
  accountId: string;
  name: string;
  enabled?: boolean;
  expirationDate?: string;
}

export type AsaasSubaccountAccessToken = {
  object?: string;
  id: string;
  name: string;
  apiKey: string;
  enabled?: boolean;
  expirationDate?: string;
  dateCreated?: string;
  projectedExpirationDateByLackOfUse?: string;
};

export async function createSubaccountAccessToken(
  params: CreateSubaccountAccessTokenParams,
): Promise<AsaasSubaccountAccessToken> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  return client.post<AsaasSubaccountAccessToken>(`/accounts/${params.accountId}/accessTokens`, {
    name: params.name,
    ...(typeof params.enabled === 'boolean' ? { enabled: params.enabled } : {}),
    ...(typeof params.expirationDate === 'string' ? { expirationDate: params.expirationDate } : {}),
  });
}
