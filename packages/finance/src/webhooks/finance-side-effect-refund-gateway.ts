import {
  listPaymentRefunds,
  refundCobranca,
  requestBankSlipRefund,
} from '../use-cases/asaas-ops';

export type FinanceSideEffectRefundGateway = {
  listPaymentRefunds: typeof listPaymentRefunds;
  refundCobranca: typeof refundCobranca;
  requestBankSlipRefund: typeof requestBankSlipRefund;
};

const productionGateway: FinanceSideEffectRefundGateway = {
  listPaymentRefunds,
  refundCobranca,
  requestBankSlipRefund,
};

let testGateway: FinanceSideEffectRefundGateway | null = null;

/** A deterministic provider seam used only by the Playwright app adapter. */
export function registerFinanceSideEffectRefundGatewayForTests(
  gateway: FinanceSideEffectRefundGateway,
): void {
  if (process.env.PLAYWRIGHT_TEST !== 'true') {
    throw new Error('The finance refund test gateway is only available in Playwright tests.');
  }
  testGateway = gateway;
}

export function getFinanceSideEffectRefundGateway(): FinanceSideEffectRefundGateway {
  return testGateway ?? productionGateway;
}
