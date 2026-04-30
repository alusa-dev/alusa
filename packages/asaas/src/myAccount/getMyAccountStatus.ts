/**
 * MyAccount Status (KYC geral)
 *
 * Endpoint (whitelabel.md):
 * - GET /v3/myAccount/status/
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasMyAccountStatus } from '../types/asaas';

export interface GetMyAccountStatusParams {
  apiKey: string;
}

export async function getMyAccountStatus(params: GetMyAccountStatusParams): Promise<AsaasMyAccountStatus> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  // O Asaas documenta com trailing slash; manter aqui para reduzir chances de 301/308.
  return client.get<AsaasMyAccountStatus>('/myAccount/status/');
}
