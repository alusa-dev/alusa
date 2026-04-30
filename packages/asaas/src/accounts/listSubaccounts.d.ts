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
export declare function listSubaccounts(params: ListSubaccountsParams): Promise<ListSubaccountsResponse>;
/**
 * Busca subconta por CPF/CNPJ.
 * Retorna a primeira encontrada ou null.
 */
export declare function findSubaccountByCpfCnpj(apiKey: string, cpfCnpj: string): Promise<AsaasSubaccountListItem | null>;
/**
 * Busca subconta por referência externa.
 * Retorna a primeira encontrada ou null.
 */
export declare function findSubaccountByExternalReference(apiKey: string, externalReference: string): Promise<AsaasSubaccountListItem | null>;
//# sourceMappingURL=listSubaccounts.d.ts.map