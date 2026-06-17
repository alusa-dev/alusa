import { AsaasHttp } from '../client/AsaasHttp';
import type {
  ConfigureNationalPortalInput,
  ConfigureNationalPortalResponse,
} from '../types/fiscal';

export interface ConfigureNationalPortalParams {
  apiKey: string;
  data: ConfigureNationalPortalInput;
}

export async function configureNationalPortal(
  params: ConfigureNationalPortalParams,
): Promise<ConfigureNationalPortalResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.post<ConfigureNationalPortalResponse>('/fiscalInfo/nationalPortal', params.data);
}
