export const CONTRACT_STATUSES = ['PENDENTE', 'ASSINADO', 'EXPIRADO', 'CANCELADO'] as const;

export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export type ContractStatusTransitionErrorCode =
  | 'CONTRACT_ALREADY_SIGNED'
  | 'CONTRACT_CANCELLED'
  | 'CONTRACT_EXPIRED'
  | 'CONTRACT_LINK_NOT_REGENERABLE'
  | 'CONTRACT_INVALID_STATUS_TRANSITION';

export function canSignContract(status: ContractStatus) {
  return status === 'PENDENTE';
}

export function canCancelContract(status: ContractStatus) {
  return status === 'PENDENTE' || status === 'EXPIRADO';
}

export function canRegenerateContractLink(status: ContractStatus) {
  return status === 'PENDENTE' || status === 'EXPIRADO';
}

export function canTransitionContractStatus(
  current: ContractStatus,
  next: ContractStatus,
) {
  if (current === next) return true;
  if (current === 'PENDENTE' && (next === 'ASSINADO' || next === 'EXPIRADO' || next === 'CANCELADO')) {
    return true;
  }
  if (current === 'EXPIRADO' && (next === 'PENDENTE' || next === 'CANCELADO')) return true;
  return false;
}

export function transitionContractStatus(
  current: ContractStatus,
  next: ContractStatus,
): ContractStatus {
  if (!canTransitionContractStatus(current, next)) {
    throw new Error('CONTRACT_INVALID_STATUS_TRANSITION');
  }
  return next;
}
