import type { AnticipationStatus } from './types';

export function formatCurrency(value: number | null | undefined): string {
  return Number(value ?? 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '-';
  const [date] = value.split('T');
  const [year, month, day] = date.split('-');
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

export function formatBillingType(value: string | null | undefined): string {
  switch (value) {
    case 'CREDIT_CARD':
    case 'CARTAO_CREDITO':
      return 'Cartão de crédito';
    case 'BOLETO':
      return 'Boleto';
    case 'PIX':
      return 'Pix';
    default:
      return value ?? 'Não informado';
  }
}

export function formatAnticipationStatus(status: AnticipationStatus): string {
  switch (status) {
    case 'PENDING':
      return 'Em análise';
    case 'SCHEDULED':
      return 'Agendada';
    case 'CREDITED':
      return 'Creditada';
    case 'DENIED':
      return 'Negada';
    case 'CANCELLED':
      return 'Cancelada';
    case 'DEBITED':
      return 'Debitada';
    case 'OVERDUE':
      return 'Vencida';
    default:
      return status;
  }
}

export function statusTone(status: AnticipationStatus) {
  switch (status) {
    case 'CREDITED':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'PENDING':
    case 'SCHEDULED':
      return 'bg-amber-50 text-amber-700 border-amber-200';
    case 'DENIED':
    case 'CANCELLED':
    case 'OVERDUE':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    case 'DEBITED':
    default:
      return 'bg-slate-50 text-slate-700 border-slate-200';
  }
}

export function sourceLabel(value: string): string {
  switch (value) {
    case 'ACADEMIC':
      return 'Cobrança acadêmica';
    case 'STANDALONE':
      return 'Cobrança avulsa';
    case 'ACADEMIC_INSTALLMENT':
      return 'Parcelamento acadêmico';
    case 'STANDALONE_INSTALLMENT':
      return 'Parcelamento avulso';
    default:
      return 'Asaas';
  }
}
