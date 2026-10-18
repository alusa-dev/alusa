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
  // The local operation key is not a provider guarantee; this endpoint does
  // not document Idempotency-Key support.
  return client.post<AsaasPixTransaction>('/pix/qrCodes/pay', params.data);
}
