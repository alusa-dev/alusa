/**
 * Obtenção de QR Code PIX de um payment
 */
import type { PixQrCodeResponse } from '../types/asaas';
export interface GetPixQrCodeParams {
    apiKey: string;
    paymentId: string;
}
/**
 * Obtém QR Code PIX de um payment
 *
 * @param params.apiKey - API key da subconta
 * @param params.paymentId - ID do payment no Asaas
 * @returns QR Code (encodedImage + payload)
 */
export declare function getPixQrCode(params: GetPixQrCodeParams): Promise<PixQrCodeResponse>;
//# sourceMappingURL=getPixQrCode.d.ts.map