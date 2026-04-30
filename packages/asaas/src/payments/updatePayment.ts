/**
 * Atualização de cobrança (payment) no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasPayment, CreatePaymentInput } from '../types/asaas';

export interface UpdatePaymentParams {
  apiKey: string;
  paymentId: string;
  data: Partial<CreatePaymentInput>;
}

export async function updatePayment(params: UpdatePaymentParams): Promise<AsaasPayment> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.put<AsaasPayment>(`/payments/${params.paymentId}`, params.data);
}
