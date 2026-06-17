import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasFiscalMunicipalOptions } from '../types/fiscal';

export interface GetMunicipalOptionsParams {
  apiKey: string;
}

export async function getMunicipalOptions(
  params: GetMunicipalOptionsParams,
): Promise<AsaasFiscalMunicipalOptions> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.get<AsaasFiscalMunicipalOptions>('/fiscalInfo/municipalOptions');
}
