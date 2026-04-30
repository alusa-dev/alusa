import type { AsaasPayment, AsaasPaymentStatusResponse } from '@alusa/asaas';

import { recordAsaasReadIntent } from '../foundation/asaas-read-intent';
import { getPayment, getPaymentStatus } from './asaas-ops';

type PaymentCommandPreflightStats = {
  statusOnly: number;
  fullPayment: number;
};

const stats: PaymentCommandPreflightStats = {
  statusOnly: 0,
  fullPayment: 0,
};

export async function readPaymentStatusPreflight(
  paymentId: string,
  opts: { contaId: string },
): Promise<AsaasPaymentStatusResponse> {
  stats.statusOnly += 1;
  recordAsaasReadIntent('COMMAND_PREFLIGHT_STATUS');
  return getPaymentStatus(paymentId, opts);
}

export async function readPaymentFullPreflight(
  paymentId: string,
  opts: { contaId: string },
): Promise<AsaasPayment> {
  stats.fullPayment += 1;
  recordAsaasReadIntent('COMMAND_PREFLIGHT_FULL');
  return getPayment(paymentId, opts);
}

export function getPaymentCommandPreflightStats(): PaymentCommandPreflightStats {
  return { ...stats };
}

export function resetPaymentCommandPreflightStats(): void {
  stats.statusOnly = 0;
  stats.fullPayment = 0;
}
