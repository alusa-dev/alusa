/**
 * Obtém informações de cobrança (billing info) de um pagamento no Asaas
 *
 * HTTP-only: sem regras de negócio.
 */

import { AsaasHttp } from '../client/AsaasHttp';

export interface BillingInfoPix {
  encodedImage: string;
  payload: string;
  expirationDate: string;
  description?: string;
}

export interface BillingInfoBankSlip {
  identificationField: string;
  nossoNumero: string;
  barCode: string;
  bankSlipUrl: string;
  daysAfterDueDateToRegistrationCancellation?: number;
}

export interface BillingInfoCreditCard {
  creditCardNumber: string;
  creditCardBrand: string;
  creditCardToken?: string;
}

export interface BillingInfoResponse {
  pix?: BillingInfoPix;
  bankSlip?: BillingInfoBankSlip;
  creditCard?: BillingInfoCreditCard;
}

export interface GetBillingInfoParams {
  apiKey: string;
  paymentId: string;
}

/**
 * Obtém informações de cobrança (QR Code Pix, boleto, etc.)
 *
 * @param params.apiKey - API key da subconta
 * @param params.paymentId - ID do payment no Asaas
 * @returns Informações de cobrança
 */
export async function getBillingInfo(params: GetBillingInfoParams): Promise<BillingInfoResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  return client.get<BillingInfoResponse>(`/payments/${params.paymentId}/billingInfo`);
}
