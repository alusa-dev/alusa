import type { LedgerEntry, LedgerEntryType, LedgerEntryStatus } from '../dtos';

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

/** Nome curto da instituição em listagens compactas; `title` pode levar o nome completo. */
export function abbreviateBankName(name: string | null | undefined) {
  if (!name?.trim()) return '—';
  let t = name.trim();
  t = t.replace(/\s*-\s*INSTITUI[ÇC][AÃ]O\s+DE\s+PAGAMENTO.*$/i, '');
  t = t.replace(/\s*-\s*IP\b.*$/i, '');
  t = t.replace(/\s+\(?IP\)?\s*$/i, '');
  t = t.replace(/\b(S\.A\.|SA|LTDA\.?)\s*,?\s*$/i, '');
  t = t.replace(/\s{2,}/g, ' ').trim();

  const compact = t.toLowerCase();
  if (compact.includes('nu pagamentos') || compact === 'nubank') return 'Nubank';
  if (compact.includes('banco do brasil')) return 'BB';
  if (compact.includes('bradesco')) return 'Bradesco';
  if (compact.includes('santander')) return 'Santander';
  if (compact.includes('caixa')) return 'Caixa';
  if (compact.includes('itaú') || compact.includes('itau')) return 'Itaú';
  if (compact.includes('inter')) return 'Inter';
  if (compact.includes('c6 bank') || compact.includes('c6 ')) return 'C6';
  if (compact.includes('btg')) return 'BTG';
  if (compact.includes('picpay')) return 'PicPay';
  if (compact.includes('mercado pago')) return 'Mercado Pago';
  if (compact.includes('stone')) return 'Stone';
  if (compact.includes('bacen') && compact.includes('banco virtual')) return 'Banco Virtual';

  const maxLen = 18;
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen - 1)}…`;
}

/** Documento mascarado para lista; preserva valor já vindo com asteriscos da API. */
export function transferDocumentForList(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const v = value.trim();
  if (/\*/.test(v)) return v;
  const digits = v.replace(/\D/g, '');
  if (digits.length === 11) return `***.${digits.slice(3, 6)}.***.***`;
  if (digits.length === 14) return `**.***.${digits.slice(6, 9)}/****-**`;
  return v;
}

/** Linha “Pix / Ted / tipo” na lista mobile do extrato. */
export function extratoMobileMethodLine(entry: LedgerEntry): string {
  if (entry.type === 'TRANSFERENCIA') {
    const cat = entry.metadata?.rawCategory;
    const asaasType = entry.metadata?.asaasType ?? '';
    if (cat === 'PIX_DEBIT' || asaasType.includes('PIX_TRANSACTION_DEBIT')) return 'Pix';
    if (cat === 'TRANSFER_SENT' || asaasType === 'TRANSFER') return 'Ted';
    const d = entry.description?.toLowerCase() ?? '';
    if (d.includes('pix')) return 'Pix';
    return 'Ted';
  }
  return formatTypeLabel(entry.type);
}
