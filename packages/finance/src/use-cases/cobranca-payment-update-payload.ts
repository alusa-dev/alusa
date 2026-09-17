import type { AsaasPayment, CreatePaymentInput } from '@alusa/asaas';

import { parseDiscountDueDateLimitDays } from './discount-rules';

export type CobrancaPaymentUpdateChanges = {
  valor?: number;
  vencimento?: string | Date;
  descricao?: string | null;
  jurosPercentual?: number;
  multaValorFixo?: number;
  multaPercentual?: number;
  descontoPercentual?: number;
  descontoValorFixo?: number;
  descontoPrazoMaximo?: string | null;
  desconto?: number;
  normalizedMultaTipo?: string;
  normalizedDescontoTipo?: string;
};

/** Normaliza aliases históricos persistidos pelas telas para o enum financeiro. */
export function normalizeCobrancaPaymentAdjustmentType(tipo?: string | null): string | undefined {
  if (!tipo) return undefined;

  const upper = tipo.toUpperCase();
  if (upper === 'FIXO' || upper === 'VALOR_FIXO') return 'VALOR_FIXO';
  if (upper === 'PERCENTUAL' || upper === 'PERCENTAGE') return 'PERCENTUAL';
  return upper;
}

/**
 * Normaliza o prazo local de desconto. Desconto zerado não deve manter um
 * prazo residual no Asaas nem no read model local.
 */
export function resolveCanonicalDiscountDueDateLimit(params: {
  descontoPrazoMaximo?: string | null;
  normalizedDescontoTipo?: string;
  descontoPercentual?: number;
  descontoValorFixo?: number;
  desconto?: number;
}): string | undefined {
  if (params.descontoPrazoMaximo === undefined) return undefined;

  const discountValue =
    params.normalizedDescontoTipo === 'VALOR_FIXO'
      ? Number(params.descontoValorFixo ?? params.desconto ?? 0)
      : Number(params.descontoPercentual ?? params.desconto ?? 0);

  if (!Number.isFinite(discountValue) || discountValue <= 0) {
    return 'ATE_VENCIMENTO';
  }

  const days = parseDiscountDueDateLimitDays(params.descontoPrazoMaximo);
  return days === 0 ? 'ATE_VENCIMENTO' : `${days}_${days === 1 ? 'DIA' : 'DIAS'}`;
}

/**
 * Constrói o menor payload compatível com o Asaas a partir do snapshot do
 * pagamento e dos campos alterados pela Alusa. A leitura prévia e a execução
 * do comando permanecem a cargo do caso de uso chamador.
 */
export function buildCobrancaAsaasPaymentUpdatePayload(params: {
  currentPayment: Pick<AsaasPayment, 'billingType' | 'value' | 'dueDate'>;
  changes: CobrancaPaymentUpdateChanges;
}): Partial<CreatePaymentInput> {
  const { currentPayment, changes } = params;
  const payload: Partial<CreatePaymentInput> = {
    billingType: currentPayment.billingType ?? 'UNDEFINED',
    value: changes.valor !== undefined ? Number(changes.valor) : Number(currentPayment.value ?? 0),
    dueDate:
      changes.vencimento !== undefined
        ? formatPaymentDueDate(changes.vencimento)
        : currentPayment.dueDate,
  };

  if (changes.descricao !== undefined) {
    payload.description = String(changes.descricao || '');
  }

  if (changes.jurosPercentual !== undefined && Number(changes.jurosPercentual) >= 0) {
    payload.interest = { value: Number(changes.jurosPercentual) };
  }

  if (
    (changes.multaPercentual !== undefined || changes.multaValorFixo !== undefined) &&
    Number(
      changes.normalizedMultaTipo === 'VALOR_FIXO'
        ? changes.multaValorFixo
        : changes.multaPercentual,
    ) >= 0
  ) {
    payload.fine = {
      value: Number(
        changes.normalizedMultaTipo === 'VALOR_FIXO'
          ? changes.multaValorFixo
          : changes.multaPercentual,
      ),
      type: changes.normalizedMultaTipo === 'VALOR_FIXO' ? 'FIXED' : 'PERCENTAGE',
    };
  }

  const dueDateLimitDays = parseDiscountDueDateLimitDays(changes.descontoPrazoMaximo);

  if (changes.descontoPercentual !== undefined && changes.normalizedDescontoTipo !== 'VALOR_FIXO') {
    const discountValue = Math.max(0, Number(changes.descontoPercentual) || 0);
    payload.discount = {
      value: discountValue,
      type: 'PERCENTAGE',
      dueDateLimitDays: discountValue > 0 ? dueDateLimitDays : 0,
    };
  } else if (changes.descontoValorFixo !== undefined && changes.normalizedDescontoTipo === 'VALOR_FIXO') {
    const discountValue = Math.max(0, Number(changes.descontoValorFixo) || 0);
    payload.discount = {
      value: discountValue,
      type: 'FIXED',
      dueDateLimitDays: discountValue > 0 ? dueDateLimitDays : 0,
    };
  } else if (changes.desconto !== undefined) {
    const discountValue = Math.max(0, Number(changes.desconto) || 0);
    payload.discount = {
      value: discountValue,
      type: changes.normalizedDescontoTipo === 'VALOR_FIXO' ? 'FIXED' : 'PERCENTAGE',
      dueDateLimitDays: discountValue > 0 ? dueDateLimitDays : 0,
    };
  }

  return payload;
}

function formatPaymentDueDate(value: string | Date): string {
  if (typeof value === 'string') {
    return value.includes('T') ? value.split('T')[0] : value;
  }

  return value.toISOString().slice(0, 10);
}
