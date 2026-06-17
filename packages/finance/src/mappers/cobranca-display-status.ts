import type { LiquidacaoStatus, StatusCobranca } from '@prisma/client';
import { resolveChargeDisplayStatus } from './asaas-display-status';

export type CobrancaDisplayStatus = {
  status?: string;
  label: string;
  hint: string | null;
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
};

const TERMINAL_STATUSES = new Set<StatusCobranca>([
  'PAGO',
  'CANCELADO',
  'ESTORNADO',
  'ESTORNADO_PARCIAL',
]);

const FINAL_DYNAMIC_STATUSES = new Set<StatusCobranca>([
  'PAGO',
  'CANCELADO',
  'ESTORNADO',
  'ESTORNADO_PARCIAL',
]);

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Calcula status derivado de vencimento sem alterar status persistido de negócio.
 */
export function calculateCobrancaDynamicStatus(
  status: StatusCobranca,
  vencimento: Date,
): StatusCobranca {
  if (FINAL_DYNAMIC_STATUSES.has(status)) return status;
  if (status === 'PROCESSANDO') return status;

  const today = startOfDay(new Date());
  const due = startOfDay(vencimento);

  if (due.getTime() > today.getTime()) return 'A_VENCER';
  if (due.getTime() < today.getTime()) return 'ATRASADO';
  return 'PENDENTE';
}

/**
 * @deprecated Use `calculateCobrancaDynamicStatus`.
 */
export const calculateDynamicStatus = calculateCobrancaDynamicStatus;

/**
 * Rótulo composto para UI — não altera StatusCobranca de negócio.
 */
export function resolveCobrancaDisplayStatus(params: {
  status: StatusCobranca;
  liquidacaoStatus?: LiquidacaoStatus | null;
  asaasStatus?: string | null;
}): CobrancaDisplayStatus {
  return resolveChargeDisplayStatus({
    localStatus: params.status,
    liquidacaoStatus: params.liquidacaoStatus,
    asaasStatus: params.asaasStatus,
    hasAsaasLink: Boolean(params.asaasStatus || params.liquidacaoStatus),
  });
}

export function isCobrancaStatusTerminal(status: StatusCobranca): boolean {
  return TERMINAL_STATUSES.has(status);
}
