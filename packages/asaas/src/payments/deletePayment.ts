/**
 * Remoção (delete) de cobrança (payment) no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasPayment } from '../types/asaas';

export interface DeletePaymentParams {
  apiKey: string;
  paymentId: string;
}

export async function deletePayment(params: DeletePaymentParams): Promise<AsaasPayment> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.delete<AsaasPayment>(`/payments/${params.paymentId}`);
}
