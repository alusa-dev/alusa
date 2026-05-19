import type { StatusType } from '@/components/ui/badge';
import type { FinanceiroPagamentoHistoricoCobrancaDTO } from '@/features/financeiro/dtos';
import {
  PAYMENT_HISTORY_CATEGORY_LABELS,
  type PaymentHistoryCategory,
} from '@/features/financeiro/pagamentos/payment-history-categories';

export type HistoricoCobranca = FinanceiroPagamentoHistoricoCobrancaDTO;

export const FORMA_LABELS: Record<string, string> = {
  BOLETO: 'Boleto',
  PIX: 'Pix',
  CARTAO_CREDITO: 'Cartão de Crédito',
  CREDIT_CARD: 'Cartão de Crédito',
  CARTAO_DEBITO: 'Cartão de Débito',
  DEBIT_CARD: 'Cartão de Débito',
  INDEFINIDO: 'Não definido',
  UNDEFINED: 'Não definido',
  DINHEIRO: 'Dinheiro',
  TRANSFERENCIA: 'Transferência',
};

export const STATUS_OPTIONS = [
  { value: 'TODOS', label: 'Todos status' },
  { value: 'PAGO', label: 'Pago' },
  { value: 'CONFIRMADO', label: 'Confirmado' },
  { value: 'CONFIRMED', label: 'Confirmado Asaas' },
  { value: 'RECEIVED', label: 'Recebido' },
  { value: 'RECEIVED_IN_CASH', label: 'Recebido em dinheiro' },
  { value: 'DUNNING_RECEIVED', label: 'Recebido por régua' },
  { value: 'ESTORNADO', label: 'Estornado' },
];

export const FORMA_OPTIONS = [
  { value: 'TODOS', label: 'Todas formas' },
  { value: 'PIX', label: 'Pix' },
  { value: 'BOLETO', label: 'Boleto' },
  { value: 'CARTAO_CREDITO', label: 'Cartão de crédito' },
  { value: 'CREDIT_CARD', label: 'Cartão de crédito' },
  { value: 'CARTAO_DEBITO', label: 'Cartão de débito' },
  { value: 'DEBIT_CARD', label: 'Cartão de débito' },
  { value: 'DINHEIRO', label: 'Dinheiro' },
  { value: 'PIX_PRESENCIAL', label: 'Pix presencial' },
  { value: 'INDEFINIDO', label: 'Não definido' },
];

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

export function formatDate(dateStr: string | null) {
  if (!dateStr) return '—';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(dateStr));
  } catch {
    return '—';
  }
}

export function getInitials(nome: string) {
  const parts = nome.split(' ').filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function resolveStatus(c: HistoricoCobranca): StatusType {
  const raw = c.pagamento ? c.pagamento.status : c.status;
  const map: Record<string, StatusType> = {
    CONFIRMADO: 'CONFIRMADO',
    PAGO: 'PAGO',
    PENDENTE: 'PENDENTE',
    A_VENCER: 'A_VENCER',
    ATRASADO: 'ATRASADO',
    ESTORNADO: 'ESTORNADO',
    ESTORNADO_PARCIAL: 'ESTORNADO_PARCIAL',
    CANCELADO: 'CANCELADO',
    CANCELAMENTO_PENDENTE: 'CANCELAMENTO_PENDENTE',
    PROCESSANDO: 'PROCESSANDO',
    CONFIRMED: 'CONFIRMED',
    RECEIVED: 'RECEIVED',
    OVERDUE: 'OVERDUE',
    REFUNDED: 'REFUNDED',
    CANCELED: 'CANCELED',
    PENDING: 'PENDING',
    PAID: 'PAID',
    OPEN: 'OPEN',
    CREATED: 'CREATED',
  };
  return map[raw] ?? 'PENDENTE';
}

export function resolveValorExibido(c: HistoricoCobranca) {
  if (c.pagamento) return c.pagamento.valorPago;
  return c.valor;
}

export function resolveDataExibida(c: HistoricoCobranca) {
  if (c.pagamento?.dataPagamento) return c.pagamento.dataPagamento;
  return c.vencimento;
}

export function resolveForma(c: HistoricoCobranca) {
  const raw = c.pagamento?.formaPagamento ?? c.billingType ?? '';
  return FORMA_LABELS[raw] || raw || '—';
}

export function formatDateInput(value: string) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('pt-BR');
}

export function toDateValue(value: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function toIsoDate(value: Date | undefined) {
  if (!value) return '';
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getCategoryLabel(category: PaymentHistoryCategory) {
  return PAYMENT_HISTORY_CATEGORY_LABELS[category];
}

export function isPaidStatus(status: string | null | undefined) {
  return ['PAGO', 'CONFIRMADO', 'CONFIRMED', 'RECEIVED', 'PAID', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED'].includes(
    status ?? '',
  );
}

export function filterHistoricoCobrancas(
  cobrancas: HistoricoCobranca[],
  filters: {
    searchTerm: string;
    dataInicio: string;
    dataFim: string;
    statusFilter: string;
    categoryFilter: string;
    formaFilter: string;
  },
) {
  return cobrancas.filter((c) => {
    if (filters.searchTerm) {
      const q = filters.searchTerm.toLowerCase();
      const category = getCategoryLabel(c.category).toLowerCase();
      const desc = c.description ?? '';
      const forma = resolveForma(c);
      const payer = c.payerName.toLowerCase();
      if (
        !category.includes(q) &&
        !desc.toLowerCase().includes(q) &&
        !forma.toLowerCase().includes(q) &&
        !payer.includes(q)
      ) {
        return false;
      }
    }

    const dataRef = resolveDataExibida(c);
    if (filters.dataInicio && dataRef) {
      if (new Date(dataRef) < new Date(`${filters.dataInicio}T00:00:00`)) return false;
    }
    if (filters.dataFim && dataRef) {
      if (new Date(dataRef) > new Date(`${filters.dataFim}T23:59:59`)) return false;
    }

    if (filters.statusFilter !== 'TODOS') {
      const status = c.pagamento ? c.pagamento.status : c.status;
      if (status !== filters.statusFilter) return false;
    }

    if (filters.categoryFilter !== 'TODOS' && c.category !== filters.categoryFilter) {
      return false;
    }

    if (filters.formaFilter !== 'TODOS') {
      const forma = c.pagamento?.formaPagamento ?? c.billingType ?? '';
      if (forma !== filters.formaFilter) return false;
    }

    return true;
  });
}

export function groupHistoricoByCategory(cobrancas: HistoricoCobranca[]) {
  const groups = new Map<PaymentHistoryCategory, HistoricoCobranca[]>();
  for (const cobranca of cobrancas) {
    const current = groups.get(cobranca.category) ?? [];
    current.push(cobranca);
    groups.set(cobranca.category, current);
  }
  return groups;
}
