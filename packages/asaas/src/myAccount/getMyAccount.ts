/**
 * MyAccount
 *
 * Endpoint (spec):
 * - GET /v3/myAccount
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasMyAccount } from '../types/asaas';

export interface GetMyAccountParams {
  apiKey: string;
}

export async function getMyAccount(params: GetMyAccountParams): Promise<AsaasMyAccount> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  return client.get<AsaasMyAccount>('/myAccount');
}
