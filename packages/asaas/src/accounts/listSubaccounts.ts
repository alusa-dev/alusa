/**
 * Lista subcontas Asaas
 * 
 * GET /v3/accounts
 * 
 * Útil para:
 * - Verificar se subconta já existe após timeout
 * - Recovery de sucesso fantasma
 * - Reconciliação
 */

import { AsaasHttp } from '../client/AsaasHttp';

export interface ListSubaccountsParams {
  apiKey: string;
  cpfCnpj?: string;
  email?: string;
  externalReference?: string;
  limit?: number;
  offset?: number;
}

export interface AsaasSubaccountListItem {
  object: 'account';
  id: string;
  name: string;
  email: string;
  cpfCnpj: string;
  mobilePhone?: string | null;
  phone?: string | null;
  incomeValue?: number | null;
  address?: string | null;
  addressNumber?: string | null;
  province?: string | null;
  postalCode?: string | null;
  complement?: string | null;
  personType?: 'FISICA' | 'JURIDICA' | null;
  companyType?: string | null;
  denialReason?: string | null;
  city?: number | null;
  state?: string | null;
  country?: string | null;
  tradingName?: string | null;
  birthDate?: string | null;
  site?: string | null;
  loginEmail?: string | null;
}

export interface ListSubaccountsResponse {
  object: 'list';
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: AsaasSubaccountListItem[];
}

/**
 * Lista subcontas da conta master.
 * 
 * @param params.apiKey - API key da conta master
 * @param params.cpfCnpj - Filtrar por CPF/CNPJ (exato)
 * @param params.email - Filtrar por e-mail (exato)
 * @param params.externalReference - Filtrar por referência externa
 */
export async function listSubaccounts(
  params: ListSubaccountsParams,
): Promise<ListSubaccountsResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  const queryParams: Record<string, string | number> = {};
  if (params.cpfCnpj) queryParams.cpfCnpj = params.cpfCnpj;
  if (params.email) queryParams.email = params.email;
  if (params.externalReference) queryParams.externalReference = params.externalReference;
  if (params.limit !== undefined) queryParams.limit = params.limit;
  if (params.offset !== undefined) queryParams.offset = params.offset;

  return client.get<ListSubaccountsResponse>('/accounts', { params: queryParams });
}

/**
 * Busca subconta por CPF/CNPJ.
 * Retorna a primeira encontrada ou null.
 */
export async function findSubaccountByCpfCnpj(
  apiKey: string,
  cpfCnpj: string,
): Promise<AsaasSubaccountListItem | null> {
  const sanitized = cpfCnpj.replace(/\D/g, '');
  const response = await listSubaccounts({ apiKey, cpfCnpj: sanitized, limit: 1 });
  return response.data[0] ?? null;
}

/**
 * Busca subconta por referência externa.
 * Retorna a primeira encontrada ou null.
 */
export async function findSubaccountByExternalReference(
  apiKey: string,
  externalReference: string,
): Promise<AsaasSubaccountListItem | null> {
  const response = await listSubaccounts({ apiKey, externalReference, limit: 1 });
  return response.data[0] ?? null;
}
