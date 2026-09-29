import type { PaymentSimulationResult } from '../types';

export async function simulateVenda(input: {
  value: number;
  installmentCount: number;
}): Promise<PaymentSimulationResult> {
  const response = await fetch('/api/financeiro/simulador-vendas', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify(input),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = typeof payload?.error === 'string' ? payload.error : 'ERRO_ASAAS';
    throw new Error(error);
  }

  if (!payload?.data) throw new Error('RESULTADO_ASAAS_INVALIDO');
  return payload.data as PaymentSimulationResult;
}
