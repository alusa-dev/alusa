export function formatReportMoney(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value);
}

export function formatReportDate(value: string | null, timeZone?: string) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timeZone ?? 'America/Sao_Paulo',
  }).format(new Date(value));
}

export function isoDay(date: Date | undefined) {
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dateFromIsoDay(value: string) {
  if (!value) return undefined;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export const STATUS_LABELS: Record<string, string> = {
  OPEN: 'A receber',
  PROCESSING: 'Em processamento',
  PAID: 'Recebido',
  OVERDUE: 'Em atraso',
  CANCELED: 'Cancelado',
  REFUNDED: 'Estornado',
};

export const TYPE_LABELS: Record<string, string> = {
  MENSALIDADE: 'Mensalidade',
  TAXA_MATRICULA: 'Taxa de matrícula',
  EXTRA: 'Extra',
  AVULSA: 'Avulsa',
  PARCELADA: 'Parcelada',
  RECORRENTE: 'Recorrente',
};

export const PAYMENT_LABELS: Record<string, string> = {
  BOLETO: 'Boleto',
  PIX: 'Pix',
  CARTAO_CREDITO: 'Cartão de crédito',
  CREDIT_CARD: 'Cartão de crédito',
  INDEFINIDO: 'Não definida',
};

