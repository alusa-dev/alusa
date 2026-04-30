/**
 * Recupera as wallets associadas à conta autenticada.
 *
 * GET /v3/wallets/
 *
 * Usado para recuperar o walletId quando não há credencial local.
 * Deve ser chamado com a API key da conta-pai (master) para subcontas.
 */

import { AsaasHttp } from '../client/AsaasHttp';

export interface GetWalletsParams {
    apiKey: string;
    [key: string]: any; // Allow filters like email, cpfCnpj, etc.
}

export interface WalletItem {
    object: string;
    id: string;
    [key: string]: any; // Allow other fields if returned
}

export interface GetWalletsResponse {
    object: string;
    hasMore: boolean;
    totalCount: number;
    limit: number;
    offset: number;
    data: WalletItem[];
}

export async function getWallets(params: GetWalletsParams): Promise<GetWalletsResponse> {
    const { apiKey, ...query } = params;
    const client = new AsaasHttp({ apiKey });
    return client.get<GetWalletsResponse>('/wallets', { params: query });
}
