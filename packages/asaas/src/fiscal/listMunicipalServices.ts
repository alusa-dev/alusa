import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasMunicipalServicesListResponse } from '../types/fiscal';

export interface ListMunicipalServicesParams {
  apiKey: string;
  offset?: number;
  limit?: number;
  description?: string;
}

export async function listMunicipalServices(
  params: ListMunicipalServicesParams,
): Promise<AsaasMunicipalServicesListResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.get<AsaasMunicipalServicesListResponse>('/fiscalInfo/services', {
    params: {
      offset: params.offset,
      limit: params.limit,
      description: params.description,
    },
  });
}
