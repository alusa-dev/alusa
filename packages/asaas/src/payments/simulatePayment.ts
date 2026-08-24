import { AsaasHttp } from '../client/AsaasHttp';
import type { BillingType } from '../types/asaas';

export type PaymentSimulationBillingType = Extract<
  BillingType,
  'BOLETO' | 'CREDIT_CARD' | 'PIX'
>;

export interface SimulatePaymentParams {
  apiKey: string;
  value: number;
  installmentCount?: number;
  billingTypes: PaymentSimulationBillingType[];
}

export interface AsaasPaymentSimulationInstallment {
  paymentNetValue?: number;
  paymentValue?: number;
}

export interface AsaasPaymentSimulationCreditCard {
  netValue?: number;
  feePercentage?: number;
  operationFee?: number;
  installment?: AsaasPaymentSimulationInstallment;
}

export interface AsaasPaymentSimulationBankSlip {
  netValue?: number;
  feeValue?: number;
  installment?: AsaasPaymentSimulationInstallment;
}

export interface AsaasPaymentSimulationPix {
  netValue?: number;
  feePercentage?: number;
  feeValue?: number;
  installment?: AsaasPaymentSimulationInstallment;
}

export interface AsaasPaymentSimulationResponse {
  value?: number;
  creditCard?: AsaasPaymentSimulationCreditCard;
  bankSlip?: AsaasPaymentSimulationBankSlip;
  pix?: AsaasPaymentSimulationPix;
}

/**
 * Simula uma cobrança sem criar payment no Asaas.
 * Contrato oficial: POST /v3/payments/simulate.
 */
export async function simulatePayment(
  params: SimulatePaymentParams,
): Promise<AsaasPaymentSimulationResponse> {
  const client = new AsaasHttp({ apiKey: params.apiKey });

  return client.post<AsaasPaymentSimulationResponse>('/payments/simulate', {
    value: params.value,
    installmentCount: params.installmentCount,
    billingTypes: params.billingTypes,
  });
}
