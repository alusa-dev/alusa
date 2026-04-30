/**
 * Lista API keys (access tokens) de uma subconta.
 *
 * GET /v3/accounts/{id}/accessTokens
 */
export interface ListSubaccountAccessTokensParams {
    apiKey: string;
    accountId: string;
    limit?: number;
    offset?: number;
}
export type AsaasSubaccountAccessTokenItem = {
    object?: string;
    id: string;
    name: string;
    enabled?: boolean;
    expirationDate?: string;
    dateCreated?: string;
    projectedExpirationDateByLackOfUse?: string;
};
export type ListSubaccountAccessTokensResponse = {
    object?: string;
    hasMore?: boolean;
    totalCount?: number;
    limit?: number;
    offset?: number;
    data: AsaasSubaccountAccessTokenItem[];
};
export declare function listSubaccountAccessTokens(params: ListSubaccountAccessTokensParams): Promise<ListSubaccountAccessTokensResponse>;
//# sourceMappingURL=listSubaccountAccessTokens.d.ts.map