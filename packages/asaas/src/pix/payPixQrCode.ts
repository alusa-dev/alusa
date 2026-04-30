import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasPixTransaction, PayPixQrCodeInput } from '../types/asaas';

export interface PayPixQrCodeParams {
  apiKey: string;
  data: PayPixQrCodeInput;
  idempotencyKey?: string;
}

export async function payPixQrCode(
  params: PayPixQrCodeParams,
): Promise<AsaasPixTransaction> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  const headers: Record<string, string> = {};

  if (params.idempotencyKey) {
    headers['Idempotency-Key'] = params.idempotencyKey;
  }

  return client.post<AsaasPixTransaction>('/pix/qrCodes/pay', params.data, { headers });
}