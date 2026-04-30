/**
 * Consulta de saldo da conta no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */
import type { AsaasFinanceBalance } from '../types/asaas';
export interface GetBalanceParams {
    apiKey: string;
}
export declare function getBalance(params: GetBalanceParams): Promise<AsaasFinanceBalance>;
//# sourceMappingURL=getBalance.d.ts.map