/**
 * MyAccount Commercial Info
 *
 * Endpoint (spec):
 * - GET /v3/myAccount/commercialInfo/
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasMyAccountCommercialInfo, UpdateMyAccountCommercialInfoInput } from '../types/asaas';

export interface GetMyAccountCommercialInfoParams {
  apiKey: string;
}

export async function getMyAccountCommercialInfo(
  params: GetMyAccountCommercialInfoParams,
): Promise<AsaasMyAccountCommercialInfo> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  // O Asaas documenta com trailing slash; manter aqui para reduzir chances de 301/308.
  return client.get<AsaasMyAccountCommercialInfo>('/myAccount/commercialInfo/');
}

export interface UpdateMyAccountCommercialInfoParams {
  apiKey: string;
  data: UpdateMyAccountCommercialInfoInput;
}

export async function updateMyAccountCommercialInfo(
  params: UpdateMyAccountCommercialInfoParams,
): Promise<AsaasMyAccountCommercialInfo> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  // O Asaas documenta com trailing slash; manter aqui para reduzir chances de 301/308.
  return client.post<AsaasMyAccountCommercialInfo>('/myAccount/commercialInfo/', params.data);
}
