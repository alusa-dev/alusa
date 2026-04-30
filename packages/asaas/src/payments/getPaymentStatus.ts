/**
 * Obter apenas o status de um payment no Asaas
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasPaymentStatusResponse } from '../types/asaas';

export interface GetPaymentStatusParams {
  apiKey: string;
  paymentId: string;
}

export async function getPaymentStatus(
  params: GetPaymentStatusParams,
): Promise<AsaasPaymentStatusResponse> {
  const client = new AsaasHttp({
    apiKey: params.apiKey,
  });

  return client.get<AsaasPaymentStatusResponse>(`/payments/${params.paymentId}/status`);
}
