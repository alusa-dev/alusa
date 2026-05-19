import type { LiquidacaoStatus, StatusCobranca } from '@prisma/client';

export type CobrancaDisplayStatus = {
  label: string;
  hint: string | null;
};

const TERMINAL_STATUSES = new Set<StatusCobranca>([
  'PAGO',
  'CANCELADO',
  'ESTORNADO',
  'ESTORNADO_PARCIAL',
]);

/**
 * Rótulo composto para UI — não altera StatusCobranca de negócio.
 */
export function resolveCobrancaDisplayStatus(params: {
  status: StatusCobranca;
  liquidacaoStatus?: LiquidacaoStatus | null;
  asaasStatus?: string | null;
}): CobrancaDisplayStatus {
  const { status, liquidacaoStatus, asaasStatus } = params;
  const remote = (asaasStatus ?? '').trim().toUpperCase();

  if (status === 'PROCESSANDO' || remote === 'AWAITING_RISK_ANALYSIS') {
    return {
      label: 'Processando',
      hint: 'Pagamento em análise de risco no Asaas.',
    };
  }

  if (status === 'A_VENCER') {
    return { label: 'A vencer', hint: 'Aguardando pagamento — vencimento futuro.' };
  }

  if (status === 'PENDENTE') {
    return { label: 'Pendente', hint: 'Aguardando pagamento.' };
  }

  if (status === 'ATRASADO' || remote === 'OVERDUE' || remote === 'DUNNING_REQUESTED') {
    return { label: 'Atrasado', hint: 'Cobrança vencida.' };
  }

  if (status === 'CANCELAMENTO_PENDENTE') {
    return { label: 'Cancelando', hint: 'Aguardando confirmação de cancelamento no Asaas.' };
  }

  if (status === 'CANCELADO') {
    return { label: 'Cancelado', hint: null };
  }

  if (status === 'ESTORNADO_PARCIAL') {
    return { label: 'Estorno parcial', hint: null };
  }

  if (status === 'ESTORNADO') {
    return { label: 'Estornado', hint: null };
  }

  if (status === 'PAGO') {
    if (remote === 'RECEIVED_IN_CASH') {
      return { label: 'Pago', hint: 'Recebido em dinheiro (confirmação manual).' };
    }

    if (liquidacaoStatus === 'PENDENTE' || remote === 'CONFIRMED') {
      return {
        label: 'Pago',
        hint: 'Pagamento confirmado — aguardando crédito na conta Asaas.',
      };
    }

    if (liquidacaoStatus === 'DISPONIVEL' || remote === 'RECEIVED' || remote === 'DUNNING_RECEIVED') {
      return { label: 'Pago', hint: 'Valor creditado ou disponível.' };
    }

    return { label: 'Pago', hint: null };
  }

  return { label: status, hint: null };
}

export function isCobrancaStatusTerminal(status: StatusCobranca): boolean {
  return TERMINAL_STATUSES.has(status);
}
