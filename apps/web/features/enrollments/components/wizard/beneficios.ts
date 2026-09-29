import type { WizardBeneficio } from './types';

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

function normalizePositiveNumber(value: number | null | undefined) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return parsed;
}

export function trimTrailingZeros(value: number) {
  const formatted = round2(value).toFixed(2);
  return formatted.endsWith('.00')
    ? formatted.slice(0, -3)
    : formatted.endsWith('0')
      ? formatted.slice(0, -1)
      : formatted;
}

export function calcularValorDescontoBeneficio(
  valorBase: number,
  beneficio?: WizardBeneficio | null,
) {
  const base = normalizePositiveNumber(valorBase);
  if (!beneficio || base <= 0) return 0;

  if (beneficio.tipo === 'PERCENTUAL') {
    const percentual = Math.min(100, normalizePositiveNumber(beneficio.valor));
    return round2(base * (percentual / 100));
  }

  return round2(Math.min(base, normalizePositiveNumber(beneficio.valor)));
}

export function calcularValorLiquidoComBeneficio(
  valorBase: number,
  beneficio?: WizardBeneficio | null,
) {
  const base = normalizePositiveNumber(valorBase);
  const desconto = calcularValorDescontoBeneficio(base, beneficio);
  return round2(Math.max(0, base - desconto));
}

export function descreverBeneficioSelecionado(beneficio?: WizardBeneficio | null) {
  if (!beneficio) return null;
  if (beneficio.tipo === 'PERCENTUAL') {
    return `${beneficio.nome} (${trimTrailingZeros(beneficio.valor)}%)`;
  }
  return `${beneficio.nome} (R$ ${trimTrailingZeros(beneficio.valor)})`;
}
