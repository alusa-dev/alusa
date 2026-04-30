// Utilitários compartilhados entre modais de criação financeira
import type { FinancePayerCandidateDTO } from '@/features/finance/dtos';

export type MultaTipo = 'PERCENTAGE' | 'FIXED';
export type DescontoTipo = 'PERCENTAGE' | 'FIXED';
export type FormaPagamento = 'BOLETO' | 'CREDIT_CARD' | 'PIX' | 'UNDEFINED';
export type Ciclo = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'BIMONTHLY' | 'QUARTERLY' | 'SEMIANNUALLY' | 'YEARLY';

export type PayerSearchResult = FinancePayerCandidateDTO;

export const FORMA_PAGAMENTO_LABELS: Record<FormaPagamento, string> = {
  BOLETO: 'Boleto Bancário',
  CREDIT_CARD: 'Cartão de Crédito',
  PIX: 'Pix',
  UNDEFINED: 'Cliente escolhe',
};

export const CICLO_LABELS: Record<Ciclo, string> = {
  WEEKLY: 'Semanal',
  BIWEEKLY: 'Quinzenal',
  MONTHLY: 'Mensal',
  BIMONTHLY: 'Bimestral',
  QUARTERLY: 'Trimestral',
  SEMIANNUALLY: 'Semestral',
  YEARLY: 'Anual',
};

export const DISCOUNT_DUE_DATE_OPTIONS = [0, 1, 2, 3, 5, 7, 10, 15, 30] as const;

// --- Formatação / Parsing ---

export function parseNumber(value: string): number | null {
  if (!value.trim()) return null;
  const normalized = value.replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalized);
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

export function formatBRLInput(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  const padded = digits.padStart(3, '0');
  let intPart = padded.slice(0, -2);
  const decPart = padded.slice(-2);
  intPart = intPart.replace(/^0+(?!$)/, '');
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${intFormatted},${decPart}`;
}

export function formatPercentInput(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '';
  const padded = digits.padStart(3, '0');
  const intPart = padded.slice(0, -2).replace(/^0+(?!$)/, '');
  const decPart = padded.slice(-2);
  return `${intPart || '0'},${decPart}`;
}

export function formatAmountToString(value: string): string | null {
  const parsed = parseNumber(value);
  if (parsed === null) return null;
  return parsed.toFixed(2);
}

// --- Classes CSS compartilhadas ---

export const controlClass =
  'flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30';

export const textAreaClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30';

export const sectionClass = 'space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4';

export const labelClass = 'text-xs font-medium text-slate-600';

// --- Payload builders ---

export interface FinancialRulesState {
  interestPercent: string;
  interestFixed: string;
  fineType: MultaTipo;
  finePercent: string;
  fineFixed: string;
  discountType: DescontoTipo;
  discountPercent: string;
  discountFixed: string;
  discountDueDateLimitDays: string;
}

export function buildFinancialRulesPayload(state: FinancialRulesState) {
  const { discountType, fineType } = state;
  const discountValue = discountType === 'PERCENTAGE' ? parseNumber(state.discountPercent) : parseNumber(state.discountFixed);
  const fineValue = fineType === 'PERCENTAGE' ? parseNumber(state.finePercent) : parseNumber(state.fineFixed);
  const interestValue = parseNumber(state.interestPercent);

  return {
    discount: discountValue && discountValue > 0 ? {
      value: discountValue,
      type: discountType,
      dueDateLimitDays: state.discountDueDateLimitDays ? Number(state.discountDueDateLimitDays) : undefined,
    } : undefined,
    interest: interestValue && interestValue > 0 ? { value: interestValue } : undefined,
    fine: fineValue && fineValue > 0 ? { value: fineValue, type: fineType } : undefined,
  };
}

export const INITIAL_FINANCIAL_RULES: FinancialRulesState = {
  interestPercent: '',
  interestFixed: '',
  fineType: 'PERCENTAGE',
  finePercent: '',
  fineFixed: '',
  discountType: 'PERCENTAGE',
  discountPercent: '',
  discountFixed: '',
  discountDueDateLimitDays: '',
};
