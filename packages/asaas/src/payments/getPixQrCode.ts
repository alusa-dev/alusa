/**
 * Obtenção de QR Code PIX de um payment
 */

import { AsaasHttp } from '../client/AsaasHttp';
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
export async function getPixQrCode(params: GetPixQrCodeParams): Promise<PixQrCodeResponse> {
  const client = new AsaasHttp({
    apiKey: params.apiKey,
  });

  return client.get<PixQrCodeResponse>(`/payments/${params.paymentId}/pixQrCode`);
}
