import type { UnifiedChargeStatus } from './charge-list-item.dto';

// ---------------------------------------------------------------------------
// Unified Billing DTOs — Fase 0
//
// Estes tipos definem o contrato entre backend e frontend para as páginas
// de cobranças. Cada página consome um DTO específico, sem ambiguidade.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Status operacional — subset de UnifiedChargeStatus visível na fila
// ---------------------------------------------------------------------------

/** Status que define um item como "operacional" (exige atenção agora). */
export const OPERATIONAL_STATUSES: readonly UnifiedChargeStatus[] = [
  'PENDING',
  'OVERDUE',
] as const;

/** Status terminais — item sai da fila operacional. */
export const TERMINAL_STATUSES: readonly UnifiedChargeStatus[] = [
  'PAID',
  'CANCELED',
  'REFUNDED',
] as const;

export type OperationalStatus = 'PENDING' | 'OVERDUE';

export function isOperationalStatus(s: UnifiedChargeStatus): s is OperationalStatus {
  return (OPERATIONAL_STATUSES as readonly string[]).includes(s);
}

// ---------------------------------------------------------------------------
// Badge unificado (para qualquer item de cobrança na UI)
// ---------------------------------------------------------------------------

export type UnifiedStatusBadge = {
  status: UnifiedChargeStatus;
  label: string;
  variant: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
};

const BADGE_MAP: Record<UnifiedChargeStatus, Omit<UnifiedStatusBadge, 'status'>> = {
  PENDING: { label: 'Pendente', variant: 'warning' },
  PROCESSING: { label: 'Processando', variant: 'info' },
  PAID: { label: 'Pago', variant: 'success' },
  OVERDUE: { label: 'Vencido', variant: 'danger' },
  CANCELED: { label: 'Cancelado', variant: 'neutral' },
  REFUNDED: { label: 'Estornado', variant: 'neutral' },
};

export function getUnifiedStatusBadge(status: UnifiedChargeStatus): UnifiedStatusBadge {
  const config = BADGE_MAP[status] ?? { label: status, variant: 'neutral' as const };
  return { status, ...config };
}

// ---------------------------------------------------------------------------
// UnifiedChargeItem — linha na fila operacional ("/cobrancas" = Todas)
// ---------------------------------------------------------------------------

export type UnifiedChargeItem = {
  /** ID interno (Charge.id ou Cobranca.id). */
  id: string;
  /** Origem do registro. */
  origin: 'ACADEMIC' | 'STANDALONE';
  /** Descrição exibida na listagem. */
  description: string | null;
  /** Nome do pagador (aluno ou responsável financeiro). */
  payerName: string;
  /** Valor da cobrança (sempre valor unitário da parcela/cobrança). */
  value: number;
  /** Data de vencimento ISO. */
  dueDate: string | null;
  /** Forma de pagamento (PIX, BOLETO, CARTAO_CREDITO). */
  billingType: string | null;
  /** Status unificado. */
  status: UnifiedChargeStatus;
  /** Tipo funcional da cobrança no domínio unificado. */
  chargeType?: 'ONE_TIME' | 'INSTALLMENT' | 'SUBSCRIPTION';
  /** Estado de vínculo local da cobrança. */
  linkStatus?: 'LINKED' | 'UNLINKED' | 'NEEDS_REVIEW';
  /** ID do pagamento no Asaas. */
  asaasPaymentId: string | null;
  /** Link oficial da fatura no Asaas, quando disponível localmente. */
  invoiceUrl?: string | null;
  /** Link oficial do boleto no Asaas, quando disponível localmente. */
  bankSlipUrl?: string | null;
  /** Tipo da cobrança original (TAXA_MATRICULA, MENSALIDADE, EXTRA, AVULSA, etc.). */
  tipo: string | null;
  /** Data de criação ISO. */
  createdAt: string;

  // Contexto acadêmico (nullable para standalone)
  matriculaId: string | null;
  alunoId: string | null;

  // Agrupamento: se este item representa um grupo (parcelamento/assinatura)
  /** true se este item é um agrupador (parcelamento com parcelas pendentes). */
  isGroup: boolean;
  /** Tipo do agrupador. */
  groupType: 'INSTALLMENT' | null;
  /** ID do parcelamento agrupador. */
  groupId: string | null;
  /** Total de parcelas no grupo. */
  installmentCount: number | null;
  /** Parcelas já pagas do grupo. */
  installmentsPaid: number | null;
};

// ---------------------------------------------------------------------------
// UnifiedInstallmentGroupItem — linha na página "/cobrancas/parcelamentos"
// ---------------------------------------------------------------------------

export type UnifiedInstallmentGroupItem = {
  /** ID do parcelamento (InstallmentPlan.id ou StandaloneInstallmentPlan.id). */
  id: string;
  /** Origem do parcelamento. */
  origin: 'ACADEMIC' | 'STANDALONE';
  /** Nome do aluno exibido na UI de parcelamentos. */
  studentName: string;
  /** Nome do pagador. */
  payerName: string;
  /** Valor total do parcelamento. */
  totalValue: number;
  /** Valor de cada parcela. */
  installmentValue: number;
  /** Número total de parcelas. */
  installmentCount: number;
  /** Parcelas pagas. */
  installmentsPaid: number;
  /** Forma de pagamento. */
  billingType: string;
  /** Data de vencimento da primeira parcela ISO. */
  firstDueDate: string;
  /** Status do parcelamento (ACTIVE, COMPLETED, CANCELED). */
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELED';
  /** Data de criação ISO. */
  createdAt: string;

  // Contexto acadêmico (nullable para standalone)
  matriculaId: string | null;
  contratoId: string | null;
  asaasInstallmentId: string | null;
};

// ---------------------------------------------------------------------------
// UnifiedSubscriptionItem — linha na página "/cobrancas/assinaturas"
// ---------------------------------------------------------------------------

export type UnifiedSubscriptionItem = {
  /** ID da assinatura local. */
  id: string;
  /** Nome do pagador. */
  payerName: string;
  /** Valor mensal. */
  value: number;
  /** Forma de pagamento. */
  billingType: string | null;
  /** Status da assinatura. */
  status: 'REQUESTED' | 'ACTIVE' | 'INACTIVE' | 'EXPIRED' | 'DELETED' | 'FAILED';
  /** Data de criação ISO. */
  createdAt: string;

  // Contexto acadêmico
  matriculaId: string;
  contratoId: string;
  asaasSubscriptionId: string | null;
};

// ---------------------------------------------------------------------------
// Normalização StatusCobranca / ChargeStatus → UnifiedChargeStatus
// ---------------------------------------------------------------------------

import type { StatusCobranca, ChargeStatus } from '@prisma/client';

const COBRANCA_TO_UNIFIED: Record<StatusCobranca, UnifiedChargeStatus> = {
  A_VENCER: 'PENDING',
  PENDENTE: 'PENDING',
  PROCESSANDO: 'PROCESSING',
  PAGO: 'PAID',
  ATRASADO: 'OVERDUE',
  CANCELAMENTO_PENDENTE: 'CANCELED',
  CANCELADO: 'CANCELED',
  ESTORNADO: 'REFUNDED',
  ESTORNADO_PARCIAL: 'REFUNDED',
};

const CHARGE_TO_UNIFIED: Record<ChargeStatus, UnifiedChargeStatus> = {
  CREATED: 'PENDING',
  PENDING_SYNC: 'PENDING',
  OPEN: 'PENDING',
  PAID: 'PAID',
  OVERDUE: 'OVERDUE',
  CANCELED: 'CANCELED',
  REFUNDED: 'REFUNDED',
};

export function normalizeCobrancaStatus(s: StatusCobranca): UnifiedChargeStatus {
  return COBRANCA_TO_UNIFIED[s] ?? 'PENDING';
}

export function normalizeChargeStatus(s: ChargeStatus): UnifiedChargeStatus {
  return CHARGE_TO_UNIFIED[s] ?? 'PENDING';
}

// ---------------------------------------------------------------------------
// Helpers temporais para fila operacional
// ---------------------------------------------------------------------------

/**
 * Retorna o último instante do mês corrente (23:59:59.999 do último dia).
 * Usado para filtro da fila operacional: dueDate <= endOfCurrentMonth.
 */
export function getEndOfCurrentMonth(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
}

/**
 * Retorna true se a data de vencimento está dentro do escopo operacional
 * (até o fim do mês corrente) OU se é overdue (passada).
 *
 * Compara apenas ano/mês/dia para evitar problemas de timezone
 * (ex: `new Date('2025-07-01')` em UTC = `2025-06-30` em BRT).
 */
export function isWithinOperationalScope(dueDate: Date | string | null, now: Date = new Date()): boolean {
  if (!dueDate) return true; // sem vencimento = incluir (pendente manual)
  // Extrair apenas YYYY-MM-DD para comparação sem timezone
  const dateStr = typeof dueDate === 'string' ? dueDate.slice(0, 10) : dueDate.toISOString().slice(0, 10);
  const [y, m, d] = dateStr.split('-').map(Number);
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  // Mês do JS é 0-based, dueDate é 1-based
  if (y < now.getFullYear()) return true;
  if (y > now.getFullYear()) return false;
  // mesmo ano
  const currentMonth = now.getMonth() + 1;
  if (m < currentMonth) return true;
  if (m > currentMonth) return false;
  // mesmo mês — dia <= último dia do mês (sempre true)
  return d <= lastDay;
}

/**
 * Filtra um array de itens para incluir apenas os que estão
 * dentro do escopo operacional (status + data).
 */
export function filterOperationalItems<T extends { status: UnifiedChargeStatus; dueDate: string | null }>(
  items: T[],
  now: Date = new Date(),
): T[] {
  return items.filter(
    (item) => isOperationalStatus(item.status) && isWithinOperationalScope(item.dueDate, now),
  );
}
