import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasNbsCode, AsaasNbsCodesListResponse } from '../types/fiscal';

export interface ListNbsCodesParams {
  apiKey: string;
  offset?: number;
  limit?: number;
  codeDescription?: string;
}

type RawNbsItem = AsaasNbsCode & {
  nbsCode?: string;
  codeDescription?: string;
};

function mapNbsItem(item: RawNbsItem): AsaasNbsCode {
  return {
    nbsCode: item.nbsCode ?? item.code,
    codeDescription: item.codeDescription ?? item.description,
    code: item.nbsCode ?? item.code,
    description: item.codeDescription ?? item.description,
  };
}

export async function listNbsCodes(params: ListNbsCodesParams): Promise<AsaasNbsCodesListResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  const response = await client.get<AsaasNbsCodesListResponse>('/fiscalInfo/nbsCodes', {
    params: {
      offset: params.offset,
      limit: params.limit,
      codeDescription: params.codeDescription,
    },
  });

  return {
    ...response,
    data: (response.data ?? []).map(mapNbsItem),
  };
}
