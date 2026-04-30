import type { LedgerEntryType, LedgerEntryStatus } from '../dtos';

export function formatCurrency(value: number, options?: { absolute?: boolean }): string {
  const normalized = options?.absolute ? Math.abs(value) : value;
  return normalized.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  });
}

export function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  if (!y || !m || !d) return dateStr;
  return `${d}/${m}/${y}`;
}

export function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;

  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatPeriodLabel(startDate?: string, endDate?: string): string {
  if (startDate && endDate) return `${formatDate(startDate)} - ${formatDate(endDate)}`;
  if (startDate) return `Desde ${formatDate(startDate)}`;
  if (endDate) return `Até ${formatDate(endDate)}`;
  return 'Período completo';
}

const TYPE_LABELS: Record<LedgerEntryType, string> = {
  RECEITA: 'Receita',
  TAXA: 'Taxa',
  ESTORNO: 'Estorno',
  TRANSFERENCIA: 'Transferência',
  ANTECIPACAO: 'Antecipação',
  AJUSTE: 'Ajuste',
};

export function formatTypeLabel(type: LedgerEntryType): string {
  return TYPE_LABELS[type] ?? type;
}

const STATUS_LABELS: Record<LedgerEntryStatus, string> = {
  CONFIRMADO: 'Confirmado',
  CANCELADO: 'Cancelado',
};

export function formatStatusLabel(status: LedgerEntryStatus): string {
  return STATUS_LABELS[status] ?? status;
}
