/**
 * Atualização de subconta Asaas (white-label)
 *
 * ADR-001: Uma subconta por tenant
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { CreateSubaccountInput, AsaasSubaccount } from '../types/asaas';

export interface UpdateSubaccountParams {
  apiKey: string;
  accountId: string;
  data: Partial<CreateSubaccountInput>;
}

export async function updateSubaccount(
  params: UpdateSubaccountParams,
): Promise<AsaasSubaccount> {
  const client = new AsaasHttp({
    apiKey: params.apiKey,
  });

  const sanitized = Object.fromEntries(
    Object.entries(params.data).filter(([, value]) => value !== undefined && value !== null),
  ) as Partial<CreateSubaccountInput>;

  return client.put<AsaasSubaccount>(`/accounts/${params.accountId}`, sanitized);
}
