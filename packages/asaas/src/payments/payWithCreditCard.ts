/**
 * Processar pagamento de uma cobrança existente via cartão de crédito
 *
 * HTTP-only: sem regras de negócio.
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasCreditCard, AsaasCreditCardHolderInfo, AsaasPayment } from '../types/asaas';

export interface PayWithCreditCardInput {
  creditCard?: AsaasCreditCard;
  creditCardHolderInfo?: AsaasCreditCardHolderInfo;
  creditCardToken?: string;
  remoteIp?: string;
}

export interface PayWithCreditCardParams {
  apiKey: string;
  paymentId: string;
  data: PayWithCreditCardInput;
}

export async function payWithCreditCard(params: PayWithCreditCardParams): Promise<AsaasPayment> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.post<AsaasPayment>(`/payments/${params.paymentId}/payWithCreditCard`, params.data);
}
