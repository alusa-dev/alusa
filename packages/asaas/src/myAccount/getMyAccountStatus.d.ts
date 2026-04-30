/**
 * MyAccount Status (KYC geral)
 *
 * Endpoint (whitelabel.md):
 * - GET /v3/myAccount/status/
 */
import type { AsaasMyAccountStatus } from '../types/asaas';
export interface GetMyAccountStatusParams {
    apiKey: string;
}
export declare function getMyAccountStatus(params: GetMyAccountStatusParams): Promise<AsaasMyAccountStatus>;
//# sourceMappingURL=getMyAccountStatus.d.ts.map