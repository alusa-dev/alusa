/**
 * Confirma recebimento em dinheiro (receiveInCash) no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasPayment } from '../types/asaas';

export interface ReceiveInCashParams {
  apiKey: string;
  paymentId: string;
  paymentDate: string; // YYYY-MM-DD
  value: number;
  notifyCustomer?: boolean;
}

export type ReceiveInCashResponse = AsaasPayment;

export async function receiveInCash(params: ReceiveInCashParams): Promise<ReceiveInCashResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  return client.post<ReceiveInCashResponse>(`/payments/${params.paymentId}/receiveInCash`, {
    paymentDate: params.paymentDate,
    value: params.value,
    ...(typeof params.notifyCustomer === 'boolean' ? { notifyCustomer: params.notifyCustomer } : {}),
  });
}
