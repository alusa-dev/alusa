import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasDecodedPixQrCode, DecodePixQrCodeInput } from '../types/asaas';

export interface DecodePixQrCodeParams {
  apiKey: string;
  data: DecodePixQrCodeInput;
}

export async function decodePixQrCode(
  params: DecodePixQrCodeParams,
): Promise<AsaasDecodedPixQrCode> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.post<AsaasDecodedPixQrCode>('/pix/qrCodes/decode', params.data);
}