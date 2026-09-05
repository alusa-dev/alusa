import { FormaPagamento, PeriodicidadePlano } from '@prisma/client';
import type { AsaasBillingType, Cycle } from '@alusa/finance';

const ASAAS_OPERATIONAL_TIME_ZONE = 'America/Sao_Paulo';

type CivilDate = { year: number; monthIndex: number; day: number };

function toUtcCivilDate(parts: CivilDate) {
  return new Date(Date.UTC(parts.year, parts.monthIndex, parts.day));
}

function compareCivilDate(left: CivilDate, right: CivilDate) {
  return Date.UTC(left.year, left.monthIndex, left.day) - Date.UTC(right.year, right.monthIndex, right.day);
}

function addCivilDays(parts: CivilDate, days: number): CivilDate {
  const date = new Date(Date.UTC(parts.year, parts.monthIndex, parts.day + days));
  return { year: date.getUTCFullYear(), monthIndex: date.getUTCMonth(), day: date.getUTCDate() };
}

function getDatePartsInTimeZone(date: Date, timeZone: string): CivilDate {
  const values = new Map(
    new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  return {
    year: Number(values.get('year')),
    monthIndex: Number(values.get('month')) - 1,
    day: Number(values.get('day')),
  };
}

function getCivilDateParts(date: Date) {
  const isUtcMidnight =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0;

  if (isUtcMidnight) {
    return {
      year: date.getUTCFullYear(),
      monthIndex: date.getUTCMonth(),
      day: date.getUTCDate(),
    };
  }

  return {
    year: date.getFullYear(),
    monthIndex: date.getMonth(),
    day: date.getDate(),
  };
}

export function resolveFirstDueDate(dataInicio: Date, vencimentoDia: number) {
  const baseParts = getCivilDateParts(dataInicio);
  const day = Math.min(28, Math.max(1, vencimentoDia));
  return toUtcCivilDate({
    year: baseParts.year,
    monthIndex: baseParts.monthIndex + (day < baseParts.day ? 1 : 0),
    day,
  });
}

/**
 * Retorna a primeira data de vencimento >= hoje.
 * Necessário para cobranças no Asaas, que rejeita datas passadas.
 */
export function resolveChargeableFirstDueDate(
  dataInicio: Date,
  vencimentoDia: number,
  now = new Date(),
): Date {
  const day = Math.min(28, Math.max(1, vencimentoDia));
  let due = getCivilDateParts(resolveFirstDueDate(dataInicio, day));
  const providerToday = getDatePartsInTimeZone(now, ASAAS_OPERATIONAL_TIME_ZONE);
  while (compareCivilDate(due, providerToday) < 0) {
    due = { year: due.year, monthIndex: due.monthIndex + 1, day };
  }
  return toUtcCivilDate(due);
}

/**
 * Retorna a data de vencimento para a taxa de matrícula avulsa.
 * Usa uma data posterior ao dia corrente do Asaas. O dia de segurança evita
 * rejeições na virada Manaus/Brasília e durante o tempo entre preview e commit.
 */
export function resolveEnrollmentFeeDueDate(dataInicio: Date, now = new Date()): Date {
  const start = getCivilDateParts(dataInicio);
  const providerTomorrow = addCivilDays(
    getDatePartsInTimeZone(now, ASAAS_OPERATIONAL_TIME_ZONE),
    1,
  );
  return toUtcCivilDate(
    compareCivilDate(start, providerTomorrow) < 0 ? providerTomorrow : start,
  );
}

export function formatIsoDate(date: Date) {
  const parts = getCivilDateParts(date);
  const year = parts.year;
  const month = String(parts.monthIndex + 1).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Compara datas de negócio sem deixar o fuso horário alterar o dia do contrato.
 */
export function isDateOnlyBefore(left: Date, right: Date) {
  return formatIsoDate(left) < formatIsoDate(right);
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

export function advanceRecurringDueDate(date: Date, periodicidade: PeriodicidadePlano): Date {
  const parts = getCivilDateParts(date);
  const next = toUtcCivilDate(parts);
  switch (periodicidade) {
    case PeriodicidadePlano.SEMANAL:
      next.setUTCDate(next.getUTCDate() + 7);
      break;
    case PeriodicidadePlano.QUINZENAL:
      next.setUTCDate(next.getUTCDate() + 14);
      break;
    case PeriodicidadePlano.TRIMESTRAL:
      next.setUTCMonth(next.getUTCMonth() + 3);
      break;
    case PeriodicidadePlano.ANUAL:
      next.setUTCFullYear(next.getUTCFullYear() + 1);
      break;
    case PeriodicidadePlano.MENSAL:
    default:
      next.setUTCMonth(next.getUTCMonth() + 1);
      break;
  }
  return next;
}

export function mapFormaPagamentoToBillingType(
  formaPagamento?: FormaPagamento | null,
): AsaasBillingType | null {
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
