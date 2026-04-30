/**
 * Atualiza o cartão de crédito de uma assinatura no Asaas (sem efetuar cobrança)
 */

import { AsaasHttp } from '../client/AsaasHttp';

export interface UpdateSubscriptionCreditCardInput {
  creditCard?: {
    holderName: string;
    number: string;
    expiryMonth: string;
    expiryYear: string;
    ccv: string;
  };
  creditCardHolderInfo?: {
    name: string;
    email: string;
    cpfCnpj: string;
    postalCode: string;
    addressNumber: string;
    addressComplement?: string;
    phone: string;
    mobilePhone?: string;
  };
  creditCardToken?: string;
  remoteIp: string;
}

export interface UpdateSubscriptionCreditCardParams {
  apiKey: string;
  subscriptionId: string;
  data: UpdateSubscriptionCreditCardInput;
}

export interface UpdateSubscriptionCreditCardResponse {
  success: boolean;
}

export async function updateSubscriptionCreditCard(
  params: UpdateSubscriptionCreditCardParams,
): Promise<UpdateSubscriptionCreditCardResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.put<UpdateSubscriptionCreditCardResponse>(
    `/subscriptions/${params.subscriptionId}/creditCard`,
    params.data,
  );
}
