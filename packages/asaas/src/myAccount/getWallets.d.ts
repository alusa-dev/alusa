/**
 * Recupera as wallets associadas à conta autenticada.
 *
 * GET /v3/wallets/
 *
 * Usado para recuperar o walletId quando não há credencial local.
 * Deve ser chamado com a API key da conta-pai (master) para subcontas.
 */
export interface GetWalletsParams {
    apiKey: string;
    [key: string]: any;
}
export interface WalletItem {
    object: string;
    id: string;
    [key: string]: any;
}
export interface GetWalletsResponse {
    object: string;
    hasMore: boolean;
    totalCount: number;
    limit: number;
    offset: number;
    data: WalletItem[];
}
export declare function getWallets(params: GetWalletsParams): Promise<GetWalletsResponse>;
//# sourceMappingURL=getWallets.d.ts.map