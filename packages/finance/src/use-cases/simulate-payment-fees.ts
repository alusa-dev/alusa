import {
  simulatePayment as asaasSimulatePayment,
  type AsaasPaymentSimulationResponse,
} from '@alusa/asaas';
import { loadAsaasCredentials } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';

import type {
  PaymentSimulationInputDTO,
  PaymentSimulationOutput,
} from '../dtos/payment-simulation';

export type PaymentSimulationError =
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'RESULTADO_ASAAS_INVALIDO'
  | 'ERRO_ASAAS';

type CardSimulation = NonNullable<AsaasPaymentSimulationResponse['creditCard']>;

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function resolveCardSimulation(response: AsaasPaymentSimulationResponse): CardSimulation | null {
  return response.creditCard ?? null;
}

function mapSimulation(params: {
  requestedValue: number;
  installmentCount: number;
  response: AsaasPaymentSimulationResponse;
  card: CardSimulation;
}): PaymentSimulationOutput | null {
  const chargeValue = params.response.value ?? params.requestedValue;
  const netValue = params.card.netValue;
  if (typeof chargeValue !== 'number' || typeof netValue !== 'number') return null;

  const installmentValue = params.card.installment?.paymentValue ?? chargeValue / params.installmentCount;
  const installmentNetValue = params.card.installment?.paymentNetValue ?? netValue / params.installmentCount;
  if (typeof installmentValue !== 'number' || typeof installmentNetValue !== 'number') return null;

  return {
    requestedValue: roundMoney(params.requestedValue),
    chargeValue: roundMoney(chargeValue),
    installmentCount: params.installmentCount,
    netValue: roundMoney(netValue),
    installmentValue: roundMoney(installmentValue),
    installmentNetValue: roundMoney(installmentNetValue),
    feeValue: roundMoney(chargeValue - netValue),
    feePercentage: typeof params.card.feePercentage === 'number' ? params.card.feePercentage : null,
    operationFee: typeof params.card.operationFee === 'number' ? params.card.operationFee : null,
  };
}

export async function simulatePaymentFees(params: {
  contaId: string;
  input: PaymentSimulationInputDTO;
}): Promise<Result<PaymentSimulationOutput, PaymentSimulationError>> {
  const credentials = await loadAsaasCredentials(params.contaId);
  if (!credentials) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

  try {
    const response = await asaasSimulatePayment({
      apiKey: credentials.apiKey,
      value: params.input.value,
      installmentCount: params.input.installmentCount > 1 ? params.input.installmentCount : undefined,
      billingTypes: ['CREDIT_CARD'],
    });
    const card = resolveCardSimulation(response);
    const result = card
      ? mapSimulation({
          requestedValue: params.input.value,
          installmentCount: params.input.installmentCount,
          response,
          card,
        })
      : null;

    return result ? ok(result) : err('RESULTADO_ASAAS_INVALIDO');
  } catch {
    return err('ERRO_ASAAS');
  }
}
