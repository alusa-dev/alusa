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

/**
 * Calcula o valor bruto necessário para preservar o líquido informado,
 * considerando a taxa percentual e a tarifa fixa retornadas pelo Asaas.
 */
export function grossUpPaymentValue(params: {
  netValue: number;
  feePercentage?: number;
  operationFee?: number;
}): number {
  const percentage = Math.max(0, params.feePercentage ?? 0) / 100;
  const operationFee = Math.max(0, params.operationFee ?? 0);

  if (percentage >= 1) return roundMoney(params.netValue + operationFee);
  return roundMoney((params.netValue + operationFee) / (1 - percentage));
}

function resolveCardSimulation(response: AsaasPaymentSimulationResponse): CardSimulation | null {
  return response.creditCard ?? null;
}

function mapSimulation(params: {
  requestedValue: number;
  simulatedValue: number;
  installmentCount: number;
  passFeesToCustomer: boolean;
  card: CardSimulation;
}): PaymentSimulationOutput | null {
  const paymentValue = params.card.installment?.paymentValue ?? params.simulatedValue;
  const paymentNetValue = params.card.installment?.paymentNetValue ?? params.card.netValue;
  if (typeof paymentNetValue !== 'number' || typeof paymentValue !== 'number') return null;

  return {
    requestedValue: roundMoney(params.requestedValue),
    simulatedValue: roundMoney(params.simulatedValue),
    installmentCount: params.installmentCount,
    passFeesToCustomer: params.passFeesToCustomer,
    paymentValue: roundMoney(paymentValue),
    paymentNetValue: roundMoney(paymentNetValue),
    feeValue: roundMoney(paymentValue - paymentNetValue),
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
    const baseResponse = await asaasSimulatePayment({
      apiKey: credentials.apiKey,
      value: params.input.value,
      installmentCount: params.input.installmentCount,
      billingTypes: ['CREDIT_CARD'],
    });
    const baseCard = resolveCardSimulation(baseResponse);
    if (!baseCard) return err('RESULTADO_ASAAS_INVALIDO');

    let response = baseResponse;
    let simulatedValue = params.input.value;

    if (params.input.passFeesToCustomer) {
      simulatedValue = grossUpPaymentValue({
        // Quando o repasse está ativo, o valor informado pelo usuário é o
        // líquido que a instituição deseja preservar.
        netValue: params.input.value,
        feePercentage: baseCard.feePercentage,
        operationFee: baseCard.operationFee,
      });

      response = await asaasSimulatePayment({
        apiKey: credentials.apiKey,
        value: simulatedValue,
        installmentCount: params.input.installmentCount,
        billingTypes: ['CREDIT_CARD'],
      });
    }

    const card = resolveCardSimulation(response);
    const result = card
      ? mapSimulation({
          requestedValue: params.input.value,
          simulatedValue,
          installmentCount: params.input.installmentCount,
          passFeesToCustomer: params.input.passFeesToCustomer,
          card,
        })
      : null;

    return result ? ok(result) : err('RESULTADO_ASAAS_INVALIDO');
  } catch {
    return err('ERRO_ASAAS');
  }
}
