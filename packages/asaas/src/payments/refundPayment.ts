/**
 * Estorno de cobrança (payment) no Asaas
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasPayment } from '../types/asaas';

export interface RefundPaymentParams {
  apiKey: string;
  paymentId: string;
  value?: number;
  description?: string;
  splitRefunds?: Array<{ id: string; value: number }>;
}

/**
 * Estorna uma cobrança (total ou parcial)
 * 
 * @param params.apiKey - API key da subconta
 * @param params.paymentId - ID do payment no Asaas
 * @param params.value - Valor a estornar (opcional, default = total)
 * @param params.description - Descrição do estorno
 * @returns Payment estornado
 */
export async function refundPayment(params: RefundPaymentParams): Promise<AsaasPayment> {
  const client = new AsaasHttp({
    apiKey: params.apiKey,
  });

  const body: Record<string, unknown> = {};
  if (params.value) body.value = params.value;
  if (params.description) body.description = params.description;
  if (Array.isArray(params.splitRefunds) && params.splitRefunds.length > 0) {
    body.splitRefunds = params.splitRefunds;
  }

  return client.post<AsaasPayment>(`/payments/${params.paymentId}/refund`, body);
}
