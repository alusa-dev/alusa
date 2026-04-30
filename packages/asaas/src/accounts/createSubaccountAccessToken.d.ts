/**
 * Cria uma API key (access token) para uma subconta.
 *
 * POST /v3/accounts/{id}/accessTokens
 */
export interface CreateSubaccountAccessTokenParams {
    apiKey: string;
    accountId: string;
    name: string;
    enabled?: boolean;
    expirationDate?: string;
}
export type AsaasSubaccountAccessToken = {
    object?: string;
    id: string;
    name: string;
    apiKey: string;
    enabled?: boolean;
    expirationDate?: string;
    dateCreated?: string;
    projectedExpirationDateByLackOfUse?: string;
};
export declare function createSubaccountAccessToken(params: CreateSubaccountAccessTokenParams): Promise<AsaasSubaccountAccessToken>;
//# sourceMappingURL=createSubaccountAccessToken.d.ts.map