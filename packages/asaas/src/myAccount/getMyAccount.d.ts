/**
 * MyAccount
 *
 * Endpoint (spec):
 * - GET /v3/myAccount
 */
import type { AsaasMyAccount } from '../types/asaas';
export interface GetMyAccountParams {
    apiKey: string;
}
export declare function getMyAccount(params: GetMyAccountParams): Promise<AsaasMyAccount>;
//# sourceMappingURL=getMyAccount.d.ts.map