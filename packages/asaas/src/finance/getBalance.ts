/**
 * Consulta de saldo da conta no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasFinanceBalance } from '../types/asaas';

export interface GetBalanceParams {
  apiKey: string;
}

export async function getBalance(params: GetBalanceParams): Promise<AsaasFinanceBalance> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.get<AsaasFinanceBalance>('/finance/balance');
}
