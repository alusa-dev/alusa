import type { FormaPagamento } from '@prisma/client';

// Mapeia FormaPagamento interno -> labels amigáveis
export const FORMA_PAGAMENTO_LABELS: Record<string, string> = {
  BOLETO: 'Boleto',
  PIX: 'Pix',
  CREDIT_CARD: 'Cartão de crédito',
  CARTAO_CREDITO: 'Cartão de crédito',
  CARTAO: 'Cartão',
  DEBITO_AUTOMATICO: 'Débito automático',
  UNDEFINED: 'A definir',
  INDEFINIDO: 'A definir',
};

export function formatFormaPagamentoLabel(value: string | null | undefined): string {
  if (!value) return '—';

  const normalized = value.trim().toUpperCase();
  return FORMA_PAGAMENTO_LABELS[normalized] ?? value;
}

export const TIPO_COBRANCA_LABELS: Record<string, string> = {
  TAXA_MATRICULA: 'Taxa de matrícula',
  MENSALIDADE: 'Mensalidade',
  EXTRA: 'Extra',
  AVULSA: 'Avulsa',
  PARCELADA: 'Parcelada',
  RECORRENTE: 'Recorrente',
};

// Mapeia FormaPagamento interno -> billingType do Asaas
export const FORMA_PAGAMENTO_TO_ASAAS: Record<FormaPagamento, string> = {
  BOLETO: 'BOLETO',
  PIX: 'PIX',
  CARTAO_CREDITO: 'CREDIT_CARD',
  INDEFINIDO: 'UNDEFINED',
};

// Aceita dd/mm/aaaa ou aaaa-mm-dd
export function validateDate(value: string): boolean {
  if (!value) return false;

  // ISO simples
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
  }

  // BR
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
    const [d, m, y] = value.split('/').map(Number);
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
  }

  return false;
}

export function dateToISO(value: string): string {
  if (!validateDate(value)) return '';

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

  const [d, m, y] = value.split('/');
  return `${y}-${m}-${d}`;
}

export function isoToDate(iso: string): string {
  if (!validateDate(iso)) return '';

  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
