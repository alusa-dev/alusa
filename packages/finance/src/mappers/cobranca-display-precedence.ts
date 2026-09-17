import type { StatusCobranca } from '@prisma/client';

/**
 * Precedência usada somente para compor o status exibido de uma cobrança.
 *
 * Esta regra é deliberadamente separada da máquina de transições persistidas:
 * o detalhe da cobrança pode combinar estado local e snapshot remoto sem
 * alterar o estado financeiro salvo.
 */
const COBRANCA_DISPLAY_STATUS_PRECEDENCE: Readonly<Record<string, number>> = {
  PENDENTE: 5,
  A_VENCER: 10,
  PROCESSANDO: 15,
  ATRASADO: 30,
  PAGO: 40,
  CANCELAMENTO_PENDENTE: 80,
  ESTORNADO_PARCIAL: 90,
  ESTORNADO: 92,
  CANCELADO: 95,
};

const CHARGE_TO_COBRANCA_DISPLAY_STATUS: Readonly<Record<string, StatusCobranca>> = {
  CREATED: 'PENDENTE',
  PENDING_SYNC: 'PENDENTE',
  OPEN: 'PENDENTE',
  OVERDUE: 'ATRASADO',
  PAID: 'PAGO',
  REFUNDED: 'ESTORNADO',
  CANCELED: 'CANCELADO',
};

export function getCobrancaDisplayStatusPrecedence(status: string | null | undefined): number {
  return status ? COBRANCA_DISPLAY_STATUS_PRECEDENCE[status] ?? 0 : 0;
}

export function chooseHighestPrecedenceCobrancaDisplayStatus(
  statuses: Array<StatusCobranca | string | null | undefined>,
): StatusCobranca | string | null {
  return statuses.reduce<StatusCobranca | string | null>((selected, candidate) => {
    if (!candidate) return selected;
    if (!selected) return candidate;
    return getCobrancaDisplayStatusPrecedence(candidate) >= getCobrancaDisplayStatusPrecedence(selected)
      ? candidate
      : selected;
  }, null);
}

export function mapChargeStatusToCobrancaDisplayStatus(status?: string | null): StatusCobranca | null {
  if (!status) return null;
  return CHARGE_TO_COBRANCA_DISPLAY_STATUS[status] ?? null;
}
