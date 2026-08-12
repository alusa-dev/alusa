import { AsaasHttp } from '../client/AsaasHttp';

export type ExternalPixKeyType = 'CPF' | 'CNPJ' | 'EMAIL' | 'PHONE' | 'EVP';

export type ExternalPixKeyResponse = {
  type?: string;
  key?: string;
  ispb?: string;
  ispbName?: string;
  financialInstitution?: {
    id?: number;
    name?: string;
    code?: string;
    bank?: { object?: string; id?: number; code?: string; name?: string };
  };
  owner?: { name?: string; cpfCnpj?: string };
};

export interface GetExternalPixKeyParams {
  apiKey: string;
  type: ExternalPixKeyType;
  key: string;
}

/** Consulta os dados públicos do titular de uma chave Pix externa. */
export async function getExternalPixKey(
  params: GetExternalPixKeyParams,
): Promise<ExternalPixKeyResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.get<ExternalPixKeyResponse>('/pix/addressKeys/external', {
    params: { type: params.type, key: params.key },
  });
}
