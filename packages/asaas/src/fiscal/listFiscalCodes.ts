import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasFiscalCodeListResponse } from '../types/fiscal';

export type FiscalCodeKind =
  | 'federalServiceCodes'
  | 'operationIndicatorCodes'
  | 'taxClassificationCodes'
  | 'taxSituationCodes';

export interface ListFiscalCodesParams {
  apiKey: string;
  kind: FiscalCodeKind;
  offset?: number;
  limit?: number;
  code?: string;
  description?: string;
}

export async function listFiscalCodes(
  params: ListFiscalCodesParams,
): Promise<AsaasFiscalCodeListResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.get<AsaasFiscalCodeListResponse>(`/fiscalInfo/${params.kind}`, {
    params: {
      offset: params.offset,
      limit: params.limit,
      code: params.code,
      description: params.description,
    },
  });
}
