import type { TransferStatus } from '@prisma/client';

// Transições permitidas — máquina de estados monotônica.
// Estados terminais (DONE, CANCELED, FAILED) não permitem transição.
// BLOCKED pode voltar a PENDING (após autorização SMS Token).
const ALLOWED_TRANSITIONS: Record<TransferStatus, ReadonlySet<TransferStatus>> = {
  REQUESTED: new Set<TransferStatus>(['PENDING', 'BLOCKED', 'PROCESSING', 'DONE', 'CANCELED', 'FAILED']),
  PENDING: new Set<TransferStatus>(['BLOCKED', 'PROCESSING', 'DONE', 'CANCELED', 'FAILED']),
  BLOCKED: new Set<TransferStatus>(['PENDING', 'PROCESSING', 'DONE', 'CANCELED', 'FAILED']),
  PROCESSING: new Set<TransferStatus>(['DONE', 'CANCELED', 'FAILED']),
  DONE: new Set<TransferStatus>(),
  CANCELED: new Set<TransferStatus>(),
  FAILED: new Set<TransferStatus>(),
};

const TERMINAL_STATUSES: ReadonlySet<TransferStatus> = new Set<TransferStatus>(['DONE', 'CANCELED', 'FAILED']);

export function isTerminalTransferStatus(status: TransferStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function isAllowedTransition(from: TransferStatus, to: TransferStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from]?.has(to) ?? false;
}

export function mapAsaasTransferStatus(status: string | null | undefined): TransferStatus | null {
  switch (status) {
    case 'PENDING':
      return 'PENDING';
    case 'BLOCKED':
      return 'BLOCKED';
    case 'BANK_PROCESSING':
      return 'PROCESSING';
    case 'DONE':
      return 'DONE';
    case 'CANCELLED':
      return 'CANCELED';
    case 'FAILED':
      return 'FAILED';
    default:
      return null;
  }
}

export function mapTransferWebhookEventToStatus(event: string | null | undefined): TransferStatus | null {
  switch (event) {
    case 'TRANSFER_CREATED':
    case 'TRANSFER_PENDING':
      return 'PENDING';
    case 'TRANSFER_IN_BANK_PROCESSING':
      return 'PROCESSING';
    case 'TRANSFER_BLOCKED':
      return 'BLOCKED';
    case 'TRANSFER_DONE':
      return 'DONE';
    case 'TRANSFER_FAILED':
      return 'FAILED';
    case 'TRANSFER_CANCELLED':
      return 'CANCELED';
    default:
      return null;
  }
}

export function resolveTransferStatus(params: {
  asaasStatus?: string | null;
  event?: string | null;
}): TransferStatus | null {
  return mapAsaasTransferStatus(params.asaasStatus) ?? mapTransferWebhookEventToStatus(params.event);
}

export function isOpenTransferStatus(status: TransferStatus): boolean {
  return status === 'REQUESTED' || status === 'PENDING' || status === 'BLOCKED' || status === 'PROCESSING';
}

export function mapTransferStatusToPixTransferSessionStatus(status: TransferStatus): 'DONE' | 'FAILED' | null {
  if (status === 'DONE') return 'DONE';
  // BLOCKED = aguardando SMS token — é temporário, não falha a sessão
  if (status === 'FAILED' || status === 'CANCELED') return 'FAILED';
  return null;
}