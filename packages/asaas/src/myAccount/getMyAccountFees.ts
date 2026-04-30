import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasMyAccountFees } from '../types/asaas';

export interface GetMyAccountFeesParams {
  apiKey: string;
}

export async function getMyAccountFees(
  params: GetMyAccountFeesParams,
): Promise<AsaasMyAccountFees> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.get<AsaasMyAccountFees>('/myAccount/fees/');
}