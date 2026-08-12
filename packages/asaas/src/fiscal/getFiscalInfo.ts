import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasFiscalInfo } from '../types/fiscal';

export interface GetFiscalInfoParams {
  apiKey: string;
}

export async function getFiscalInfo(params: GetFiscalInfoParams): Promise<AsaasFiscalInfo> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  // O endpoint oficial possui uma barra final. Mantê-la evita que o Sandbox
  // trate a consulta como uma rota diferente e retorne 404.
  return client.get<AsaasFiscalInfo>('/fiscalInfo/');
}
