/**
 * Remove uma API key (access token) de uma subconta.
 *
 * DELETE /v3/accounts/{id}/accessTokens/{accessTokenId}
 */

import { AsaasHttp } from '../client/AsaasHttp';

export interface DeleteSubaccountAccessTokenParams {
  apiKey: string;
  accountId: string;
  accessTokenId: string;
}

export type DeleteSubaccountAccessTokenResponse = {
  deleted?: boolean;
};

export async function deleteSubaccountAccessToken(
  params: DeleteSubaccountAccessTokenParams,
): Promise<DeleteSubaccountAccessTokenResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.delete<DeleteSubaccountAccessTokenResponse>(
    `/accounts/${params.accountId}/accessTokens/${params.accessTokenId}`,
  );
}
