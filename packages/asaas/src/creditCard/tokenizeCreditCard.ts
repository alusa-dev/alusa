/**
 * Tokenização de cartão de crédito no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */

import { AsaasHttp } from '../client/AsaasHttp';
import type { AsaasCreditCard, AsaasCreditCardHolderInfo } from '../types/asaas';

export interface TokenizeCreditCardInput {
  customer: string;
  creditCard: AsaasCreditCard;
  creditCardHolderInfo: AsaasCreditCardHolderInfo;
  remoteIp?: string;
}

export interface TokenizeCreditCardParams {
  apiKey: string;
  data: TokenizeCreditCardInput;
}

export interface TokenizeCreditCardResponse {
  creditCardToken: string;
}

export async function tokenizeCreditCard(
  params: TokenizeCreditCardParams,
): Promise<TokenizeCreditCardResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });
  return client.post<TokenizeCreditCardResponse>('/creditCard/tokenize', params.data);
}
