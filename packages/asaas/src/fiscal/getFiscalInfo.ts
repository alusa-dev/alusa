import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasFiscalInfo } from '../types/fiscal';

export interface GetFiscalInfoParams {
  apiKey: string;
}

export async function getFiscalInfo(params: GetFiscalInfoParams): Promise<AsaasFiscalInfo> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.get<AsaasFiscalInfo>('/fiscalInfo');
}
