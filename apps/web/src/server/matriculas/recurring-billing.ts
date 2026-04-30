import { FormaPagamento, PeriodicidadePlano } from '@prisma/client';
import type { BillingType, Cycle } from '@alusa/asaas';

function startOfToday(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function resolveFirstDueDate(dataInicio: Date, vencimentoDia: number) {
  const base = new Date(dataInicio);
  const day = Math.min(28, Math.max(1, vencimentoDia));
  const due = new Date(base.getFullYear(), base.getMonth(), day);
  if (due < startOfToday(base)) {
    return new Date(base.getFullYear(), base.getMonth() + 1, day);
  }
  return due;
}

export function formatIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function mapPeriodicidadeToCycle(periodicidade: PeriodicidadePlano): Cycle {
  switch (periodicidade) {
    case PeriodicidadePlano.SEMANAL:
      return 'WEEKLY';
    case PeriodicidadePlano.QUINZENAL:
      return 'BIWEEKLY';
    case PeriodicidadePlano.TRIMESTRAL:
      return 'QUARTERLY';
    case PeriodicidadePlano.ANUAL:
      return 'YEARLY';
    case PeriodicidadePlano.MENSAL:
    default:
      return 'MONTHLY';
  }
}

export function mapFormaPagamentoToBillingType(
  formaPagamento?: FormaPagamento | null,
): BillingType | null {
  switch (formaPagamento) {
    case FormaPagamento.BOLETO:
      return 'BOLETO';
    case FormaPagamento.PIX:
      return 'PIX';
    case FormaPagamento.CARTAO_CREDITO:
      return 'CREDIT_CARD';
    case FormaPagamento.INDEFINIDO:
      return 'UNDEFINED';
    default:
      return null;
  }
}

export function mapBillingTypeToFormaPagamento(
  billingType?: string | null,
): FormaPagamento | null {
  switch ((billingType ?? '').toUpperCase()) {
    case 'BOLETO':
      return FormaPagamento.BOLETO;
    case 'PIX':
      return FormaPagamento.PIX;
    case 'CREDIT_CARD':
      return FormaPagamento.CARTAO_CREDITO;
    case 'UNDEFINED':
      return FormaPagamento.INDEFINIDO;
    default:
      return null;
  }
}
