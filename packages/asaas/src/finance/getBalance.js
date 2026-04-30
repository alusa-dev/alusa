/**
 * Consulta de saldo da conta no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */
import { AsaasHttp } from '../client/AsaasHttp';
export async function getBalance(params) {
    const client = new AsaasHttp({ apiKey: params.apiKey });
    return client.get('/finance/balance');
}
