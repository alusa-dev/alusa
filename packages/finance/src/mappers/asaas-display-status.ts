import type { ChargeStatus, LiquidacaoStatus, StatusCobranca } from '@prisma/client';

import { isStaleAsaasStatusForSettledLocal } from './asaas-snapshot-monotonicity';

export type AsaasPaymentStatus =
  | 'PENDING'
  | 'RECEIVED'
  | 'CONFIRMED'
  | 'OVERDUE'
  | 'REFUNDED'
  | 'RECEIVED_IN_CASH'
  | 'REFUND_REQUESTED'
  | 'REFUND_IN_PROGRESS'
  | 'CHARGEBACK_REQUESTED'
  | 'CHARGEBACK_DISPUTE'
  | 'AWAITING_CHARGEBACK_REVERSAL'
  | 'DUNNING_REQUESTED'
  | 'DUNNING_RECEIVED'
  | 'AWAITING_RISK_ANALYSIS'
  | 'DELETED';

export type ChargeDisplayStatusCode =
  | AsaasPaymentStatus
  | StatusCobranca
  | ChargeStatus
  | 'MANUAL'
  | 'UNKNOWN';

export type ChargeDisplayStatusVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export type ChargeDisplayStatus = {
  status: ChargeDisplayStatusCode;
  label: string;
  hint: string | null;
  variant: ChargeDisplayStatusVariant;
  source: 'asaas' | 'liquidacao' | 'local';
};

export type ResolveChargeDisplayStatusInput = {
  asaasStatus?: string | null;
  liquidacaoStatus?: LiquidacaoStatus | string | null;
  localStatus?: StatusCobranca | ChargeStatus | string | null;
  hasAsaasLink?: boolean;
};

export const ASAAS_PAYMENT_STATUS_VALUES = [
  'PENDING',
  'RECEIVED',
  'CONFIRMED',
  'OVERDUE',
  'REFUNDED',
  'RECEIVED_IN_CASH',
  'REFUND_REQUESTED',
  'REFUND_IN_PROGRESS',
  'CHARGEBACK_REQUESTED',
  'CHARGEBACK_DISPUTE',
  'AWAITING_CHARGEBACK_REVERSAL',
  'DUNNING_REQUESTED',
  'DUNNING_RECEIVED',
  'AWAITING_RISK_ANALYSIS',
  'DELETED',
] as const satisfies readonly AsaasPaymentStatus[];

const ASAAS_PAYMENT_STATUS_SET = new Set<string>(ASAAS_PAYMENT_STATUS_VALUES);

const ASAAS_DISPLAY_STATUS_MAP: Record<AsaasPaymentStatus, Omit<ChargeDisplayStatus, 'status' | 'source'>> = {
  PENDING: {
    label: 'Pendente',
    hint: 'Aguardando pagamento.',
    variant: 'warning',
  },
  RECEIVED: {
    label: 'Recebida',
    hint: 'Valor disponível na conta Asaas.',
    variant: 'success',
  },
  CONFIRMED: {
    label: 'Confirmada',
    hint: 'Pagamento efetuado; saldo ainda não disponibilizado na conta Asaas.',
    variant: 'success',
  },
  OVERDUE: {
    label: 'Vencida',
    hint: 'Cobrança vencida.',
    variant: 'danger',
  },
  REFUNDED: {
    label: 'Estornada',
    hint: 'Cobrança estornada.',
    variant: 'neutral',
  },
  RECEIVED_IN_CASH: {
    label: 'Recebida em dinheiro',
    hint: 'Recebimento confirmado manualmente em dinheiro.',
    variant: 'success',
  },
  REFUND_REQUESTED: {
    label: 'Estorno solicitado',
    hint: 'Estorno solicitado ao Asaas.',
    variant: 'neutral',
  },
  REFUND_IN_PROGRESS: {
    label: 'Estorno em processamento',
    hint: 'Estorno em processamento no Asaas.',
    variant: 'neutral',
  },
  CHARGEBACK_REQUESTED: {
    label: 'Chargeback solicitado',
    hint: 'Chargeback recebido.',
    variant: 'danger',
  },
  CHARGEBACK_DISPUTE: {
    label: 'Chargeback em disputa',
    hint: 'Chargeback em disputa.',
    variant: 'danger',
  },
  AWAITING_CHARGEBACK_REVERSAL: {
    label: 'Aguardando reversão',
    hint: 'Disputa vencida; aguardando repasse da adquirente.',
    variant: 'warning',
  },
  DUNNING_REQUESTED: {
    label: 'Negativação solicitada',
    hint: 'Requisição de negativação enviada.',
    variant: 'danger',
  },
  DUNNING_RECEIVED: {
    label: 'Recebida por negativação',
    hint: 'Recebida via negativação.',
    variant: 'success',
  },
  DELETED: {
    label: 'Cancelada',
    hint: 'Cobrança cancelada no Asaas.',
    variant: 'neutral',
  },
  AWAITING_RISK_ANALYSIS: {
    label: 'Em análise',
    hint: 'Pagamento em cartão aguardando análise de risco.',
    variant: 'info',
  },
};

const LOCAL_DISPLAY_STATUS_MAP: Record<string, Omit<ChargeDisplayStatus, 'status' | 'source'>> = {
  PENDING: { label: 'Pendente', hint: 'Aguardando pagamento.', variant: 'warning' },
  OVERDUE: { label: 'Vencida', hint: 'Cobrança vencida.', variant: 'danger' },
  PENDENTE: { label: 'Pendente', hint: 'Aguardando pagamento.', variant: 'warning' },
  A_VENCER: { label: 'A vencer', hint: 'Aguardando pagamento; vencimento futuro.', variant: 'info' },
  PROCESSANDO: { label: 'Processando', hint: 'Pagamento em processamento.', variant: 'info' },
  ATRASADO: { label: 'Vencida', hint: 'Cobrança vencida.', variant: 'danger' },
  PAGO: { label: 'Pago', hint: 'Pagamento registrado localmente.', variant: 'success' },
  CANCELAMENTO_PENDENTE: {
    label: 'Cancelamento pendente',
    hint: 'Aguardando confirmação de cancelamento.',
    variant: 'warning',
  },
  CANCELADO: { label: 'Cancelada', hint: null, variant: 'neutral' },
  ESTORNADO: { label: 'Estornada', hint: null, variant: 'neutral' },
  ESTORNADO_PARCIAL: { label: 'Estorno parcial', hint: null, variant: 'neutral' },
  CREATED: { label: 'Criada', hint: 'Cobrança criada localmente.', variant: 'info' },
  PENDING_SYNC: { label: 'Sincronizando', hint: 'Aguardando confirmacao do Asaas.', variant: 'info' },
  OPEN: { label: 'Pendente', hint: 'Aguardando pagamento.', variant: 'warning' },
  PAID: { label: 'Pago', hint: 'Pagamento registrado localmente.', variant: 'success' },
  CANCELED: { label: 'Cancelada', hint: null, variant: 'neutral' },
  REFUNDED: { label: 'Estornada', hint: null, variant: 'neutral' },
  // Status de domínio (eventos, pedidos, entradas financeiras)
  PAYMENT_PENDING: { label: 'Pendente', hint: 'Aguardando pagamento.', variant: 'warning' },
  EXPECTED: { label: 'Previsto', hint: 'Receita ou custo previsto.', variant: 'info' },
  CONFIRMED: { label: 'Confirmada', hint: 'Pagamento confirmado.', variant: 'success' },
  RECEIVED: { label: 'Recebida', hint: 'Valor recebido.', variant: 'success' },
  CANCELLED: { label: 'Cancelada', hint: null, variant: 'neutral' },
  EXPIRED: { label: 'Expirado', hint: 'Prazo de pagamento expirado.', variant: 'neutral' },
  COMPLIMENTARY: { label: 'Cortesia', hint: 'Ingresso ou item cortesia.', variant: 'success' },
  PARTIALLY_REFUNDED: { label: 'Estorno parcial', hint: null, variant: 'neutral' },
  PROCESSING: { label: 'Processando', hint: 'Pagamento em processamento.', variant: 'info' },
};

const LOCAL_STATUS_PRECEDENCE: Record<string, number> = {
  PENDENTE: 5,
  PENDING: 5,
  CREATED: 5,
  PENDING_SYNC: 7,
  A_VENCER: 10,
  OPEN: 10,
  PROCESSANDO: 15,
  PROCESSING: 15,
  AWAITING_RISK_ANALYSIS: 15,
  ATRASADO: 30,
  OVERDUE: 30,
  PAGO: 40,
  PAID: 40,
  CONFIRMED: 40,
  RECEIVED: 45,
  RECEIVED_IN_CASH: 45,
  DUNNING_RECEIVED: 45,
  CANCELAMENTO_PENDENTE: 80,
  REFUND_REQUESTED: 82,
  REFUND_IN_PROGRESS: 84,
  CHARGEBACK_REQUESTED: 86,
  CHARGEBACK_DISPUTE: 88,
  AWAITING_CHARGEBACK_REVERSAL: 89,
  ESTORNADO_PARCIAL: 90,
  PARTIALLY_REFUNDED: 90,
  ESTORNADO: 92,
  REFUNDED: 92,
  CANCELADO: 95,
  CANCELED: 95,
  CANCELLED: 95,
  DELETED: 95,
};

const ASAAS_TO_LOCAL_DISPLAY_STATUS: Record<AsaasPaymentStatus, string> = {
  PENDING: 'PENDENTE',
  AWAITING_RISK_ANALYSIS: 'PROCESSANDO',
  OVERDUE: 'ATRASADO',
  DUNNING_REQUESTED: 'ATRASADO',
  CONFIRMED: 'PAGO',
  RECEIVED: 'PAGO',
  RECEIVED_IN_CASH: 'PAGO',
  DUNNING_RECEIVED: 'PAGO',
  REFUND_REQUESTED: 'ESTORNADO',
  REFUND_IN_PROGRESS: 'ESTORNADO',
  REFUNDED: 'ESTORNADO',
  CHARGEBACK_REQUESTED: 'ESTORNADO',
  CHARGEBACK_DISPUTE: 'ESTORNADO',
  AWAITING_CHARGEBACK_REVERSAL: 'ESTORNADO',
  DELETED: 'CANCELADO',
};

function normalize(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

function getLocalStatusPrecedence(status: string): number {
  return LOCAL_STATUS_PRECEDENCE[status] ?? 0;
}

function shouldPreferLocalStatusOverAsaas(localStatus: string, asaasStatus: AsaasPaymentStatus): boolean {
  if (!localStatus) return false;

  const mappedAsaasLocalStatus = ASAAS_TO_LOCAL_DISPLAY_STATUS[asaasStatus];
  const localRank = getLocalStatusPrecedence(localStatus);
  const asaasRank = getLocalStatusPrecedence(mappedAsaasLocalStatus);

  if (localRank > asaasRank) return true;

  // Quando os estados representam a mesma conclusão, preferimos o rótulo de domínio da Alusa.
  // Ex.: Asaas DELETED vira "Cancelada", não "Removida".
  return localRank === asaasRank && localRank >= 80;
}

function fromAsaasStatus(status: AsaasPaymentStatus): ChargeDisplayStatus {
  return {
    status,
    ...ASAAS_DISPLAY_STATUS_MAP[status],
    source: 'asaas',
  };
}

function fromLocalStatus(status: string): ChargeDisplayStatus {
  const config = LOCAL_DISPLAY_STATUS_MAP[status] ?? {
    label: 'Desconhecido',
    hint: null,
    variant: 'neutral' as const,
  };

  return {
    status: (status || 'UNKNOWN') as ChargeDisplayStatusCode,
    ...config,
    source: 'local',
  };
}

export function unifiedChargeStatusToLocal(status: string): string {
  switch (normalize(status)) {
    case 'PENDING':
      return 'PENDENTE';
    case 'OVERDUE':
      return 'ATRASADO';
    case 'PROCESSING':
      return 'PROCESSANDO';
    case 'PAID':
      return 'PAGO';
    case 'CANCELED':
      return 'CANCELADO';
    case 'REFUNDED':
      return 'ESTORNADO';
    default:
      return status;
  }
}

export function isAsaasPaymentStatus(status: string | null | undefined): status is AsaasPaymentStatus {
  return ASAAS_PAYMENT_STATUS_SET.has(normalize(status));
}

export function getAsaasDisplayStatus(status: AsaasPaymentStatus): ChargeDisplayStatus {
  return fromAsaasStatus(status);
}

export function resolveChargeDisplayStatus(input: ResolveChargeDisplayStatusInput): ChargeDisplayStatus {
  const asaasStatus = normalize(input.asaasStatus);
  const localStatus = normalize(input.localStatus);
  const liquidacaoStatus = normalize(input.liquidacaoStatus);
  const asaasStatusIsStale = isStaleAsaasStatusForSettledLocal({
    asaasStatus,
    localChargeStatus: input.localStatus,
    localCobrancaStatus: input.localStatus,
    hasAsaasLink: input.hasAsaasLink,
  });

  if (isAsaasPaymentStatus(asaasStatus) && !asaasStatusIsStale) {
    if (shouldPreferLocalStatusOverAsaas(localStatus, asaasStatus)) {
      return fromLocalStatus(localStatus);
    }
    return fromAsaasStatus(asaasStatus);
  }

  if (input.hasAsaasLink && ['PAGO', 'PAID'].includes(localStatus)) {
    if (liquidacaoStatus === 'PENDENTE') {
      return { ...fromAsaasStatus('CONFIRMED'), source: 'liquidacao' };
    }
    if (liquidacaoStatus === 'DISPONIVEL') {
      return { ...fromAsaasStatus('RECEIVED'), source: 'liquidacao' };
    }
  }

  return fromLocalStatus(localStatus);
}

export function getChargeDisplayStatusLabel(status: string): string {
  if (isAsaasPaymentStatus(status)) return ASAAS_DISPLAY_STATUS_MAP[normalize(status) as AsaasPaymentStatus].label;
  return LOCAL_DISPLAY_STATUS_MAP[normalize(status)]?.label ?? 'Desconhecido';
}

export function getChargeDisplayStatusVariant(status: string): ChargeDisplayStatusVariant {
  if (isAsaasPaymentStatus(status)) return ASAAS_DISPLAY_STATUS_MAP[normalize(status) as AsaasPaymentStatus].variant;
  return LOCAL_DISPLAY_STATUS_MAP[normalize(status)]?.variant ?? 'neutral';
}
