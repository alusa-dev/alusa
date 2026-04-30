/**
 * Recupera as wallets associadas à conta autenticada.
 *
 * GET /v3/wallets/
 *
 * Usado para recuperar o walletId quando não há credencial local.
 * Deve ser chamado com a API key da conta-pai (master) para subcontas.
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function getWallets(params) {
    const { apiKey, ...query } = params;
    const client = new AsaasHttp({ apiKey });
    return client.get('/wallets', { params: query });
}
