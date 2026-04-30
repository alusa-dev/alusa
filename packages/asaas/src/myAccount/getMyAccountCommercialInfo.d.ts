/**
 * MyAccount Commercial Info
 *
 * Endpoint (spec):
 * - GET /v3/myAccount/commercialInfo/
 */
import type { AsaasMyAccountCommercialInfo, UpdateMyAccountCommercialInfoInput } from '../types/asaas';
export interface GetMyAccountCommercialInfoParams {
    apiKey: string;
}
export declare function getMyAccountCommercialInfo(params: GetMyAccountCommercialInfoParams): Promise<AsaasMyAccountCommercialInfo>;
export interface UpdateMyAccountCommercialInfoParams {
    apiKey: string;
    data: UpdateMyAccountCommercialInfoInput;
}
export declare function updateMyAccountCommercialInfo(params: UpdateMyAccountCommercialInfoParams): Promise<AsaasMyAccountCommercialInfo>;
//# sourceMappingURL=getMyAccountCommercialInfo.d.ts.map