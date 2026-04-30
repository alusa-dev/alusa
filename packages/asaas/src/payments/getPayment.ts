/**
 * Obter detalhes de um payment no Asaas
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasPayment } from '../types/asaas';

export interface GetPaymentParams {
  apiKey: string;
  paymentId: string;
}

export async function getPayment(params: GetPaymentParams): Promise<AsaasPayment> {
  const client = new AsaasHttp({
    apiKey: params.apiKey,
  });

  return client.get<AsaasPayment>(`/payments/${params.paymentId}`);
}
