import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasFiscalInfo } from '../types/fiscal';

export interface GetFiscalInfoParams {
  apiKey: string;
}

export async function getFiscalInfo(params: GetFiscalInfoParams): Promise<AsaasFiscalInfo> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  // O endpoint oficial é documentado com a barra final.
  // Uma conta sem configuração fiscal também responde 404. Esse é um estado
  // esperado da conta, e não uma indisponibilidade da API do Asaas.
  return client.get<AsaasFiscalInfo>('/fiscalInfo/', {
    expectedErrorStatuses: [404],
  });
}
