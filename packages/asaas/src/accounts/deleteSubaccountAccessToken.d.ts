/**
 * Remove uma API key (access token) de uma subconta.
 *
 * DELETE /v3/accounts/{id}/accessTokens/{accessTokenId}
 */
export interface DeleteSubaccountAccessTokenParams {
    apiKey: string;
    accountId: string;
    accessTokenId: string;
}
export type DeleteSubaccountAccessTokenResponse = {
    deleted?: boolean;
};
export declare function deleteSubaccountAccessToken(params: DeleteSubaccountAccessTokenParams): Promise<DeleteSubaccountAccessTokenResponse>;
//# sourceMappingURL=deleteSubaccountAccessToken.d.ts.map