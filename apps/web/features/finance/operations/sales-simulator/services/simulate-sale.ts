import type { PaymentSimulationResult } from '../types';

function isErrorCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,79}$/.test(value);
}

function resolveErrorCode(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return 'ERRO_ASAAS';
  const body = payload as { error?: unknown; code?: unknown };
  if (isErrorCode(body.error)) return body.error;
  if (isErrorCode(body.code)) return body.code;
  return 'ERRO_ASAAS';
}

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
    throw new Error(resolveErrorCode(payload));
  }

  if (!payload?.data) throw new Error('RESULTADO_ASAAS_INVALIDO');
  return payload.data as PaymentSimulationResult;
}
