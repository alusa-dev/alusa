import { BillingAgreementError } from './errors';

export function assertMoneyCents(value: number, field: string, options?: { allowZero?: boolean }): void {
  if (!Number.isSafeInteger(value) || value < 0 || (!options?.allowZero && value === 0)) {
    throw new BillingAgreementError(
      'INVALID_INPUT',
      `${field} deve ser informado em centavos inteiros e não negativos.`,
      { field },
    );
  }
}

export function sumMoneyCents(values: readonly number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new BillingAgreementError('INVALID_INPUT', 'O total financeiro excede o limite seguro.');
  }
  return total;
}

export function centsToDecimal(cents: number): number {
  assertMoneyCents(cents, 'valueCents', { allowZero: true });
  return cents / 100;
}

export function decimalToCents(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new BillingAgreementError('REMOTE_STATE_DIVERGED', 'Valor remoto inválido.');
  }
  return Math.round((value + Number.EPSILON) * 100);
}
