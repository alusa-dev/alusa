/**
 * Recupera uma subconta Asaas (white-label)
 *
 * GET /v3/accounts/{id}
 */
export interface GetSubaccountParams {
    apiKey: string;
    accountId: string;
}
export type AsaasSubaccountDetails = {
    object: 'account' | string;
    id: string;
    name: string;
    email: string;
    cpfCnpj: string;
    mobilePhone?: string | null;
    phone?: string | null;
    address?: string;
    addressNumber?: string;
    complement?: string | null;
    province?: string;
    postalCode?: string;
    personType?: 'JURIDICA' | 'FISICA' | string;
    companyType?: 'MEI' | 'LIMITED' | 'INDIVIDUAL' | 'ASSOCIATION' | string;
    walletId?: string;
};
export declare function getSubaccount(params: GetSubaccountParams): Promise<AsaasSubaccountDetails>;
//# sourceMappingURL=getSubaccount.d.ts.map