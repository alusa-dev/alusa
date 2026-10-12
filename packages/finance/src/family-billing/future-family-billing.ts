const BILLABLE_MEMBER_STATUSES = new Set([
  'PENDENTE_TAXA',
  'AGUARDANDO_CONFIRMACAO',
  'ATIVA',
  'PAUSADA',
]);

export function isBillableFamilyMemberStatus(status: string) {
  return BILLABLE_MEMBER_STATUSES.has(status);
}

export function resolveFamilyOperationFutureStart(input: {
  members: Array<{ id: string; status: string; dataInicio: Date }>;
  operationMatriculaIds?: string[] | null;
  now: Date;
  timezone?: string | null;
}) {
  const starts = input.members
    .filter((member) => (!input.operationMatriculaIds || input.operationMatriculaIds.includes(member.id)) && !TERMINAL_MEMBER_STATUSES.has(member.status))
    .map((member) => member.dataInicio)
    .filter((date) => isAcademicDateInFuture(date, input.now, input.timezone ?? undefined))
    .map((date) => {
      const key = getAcademicDateKey(date);
      return key ? getAcademicDateStartInstant(key, input.timezone ?? undefined) : date;
    })
    .sort((left, right) => right.getTime() - left.getTime());
  return starts[0] ?? null;
}

const TERMINAL_MEMBER_STATUSES = new Set(['CANCELADA', 'ENCERRADA', 'RECUSADA']);

function isBillableFamilyMember(
  member: { status: string; cobrarDurantePausa?: boolean | null },
  phase: FutureFamilyBillingPhase,
) {
  if (!isBillableFamilyMemberStatus(member.status)) return false;
  return phase !== 'RECURRING' || member.status !== 'PAUSADA' || member.cobrarDurantePausa === true;
}

export type FutureFamilyBillingPhase = 'ENROLLMENT_FEE' | 'RECURRING';

export function resolveFutureFamilyBillingAmounts(input: {
  phase: FutureFamilyBillingPhase;
  operationId: string | null | undefined;
  payload: { monthlyValue: number; enrollmentFeeValue: number };
  members: Array<{ id: string; status: string; cobrarDurantePausa?: boolean | null }>;
  allocations: Array<{ matriculaId: string | null; amount: number | string }>;
}):
  | { kind: 'CANCEL_TERMINAL' }
  | { kind: 'DEFER_PAUSED' }
  | { kind: 'REQUIRES_RECONCILIATION' }
  | {
      kind: 'PROCESS';
      totalAlunos: number;
      monthlyValue: number;
      enrollmentFeeValue: number;
    } {
  const billableMembers = input.members.filter((member) => isBillableFamilyMember(member, input.phase));
  if (billableMembers.length === 0) {
    if (
      input.phase === 'RECURRING' &&
      input.members.some((member) => member.status === 'PAUSADA' && member.cobrarDurantePausa !== true)
    ) {
      return { kind: 'DEFER_PAUSED' };
    }
    if (input.members.length === 0 || input.members.every((member) => TERMINAL_MEMBER_STATUSES.has(member.status))) {
      return { kind: 'CANCEL_TERMINAL' };
    }
    return { kind: 'REQUIRES_RECONCILIATION' };
  }

  const hasTerminalMembers = billableMembers.length < input.members.length;
  if (!hasTerminalMembers) {
    return {
      kind: 'PROCESS',
      totalAlunos: billableMembers.length,
      monthlyValue: input.payload.monthlyValue,
      enrollmentFeeValue: input.payload.enrollmentFeeValue,
    };
  }

  if (!input.operationId) return { kind: 'REQUIRES_RECONCILIATION' };

  const billableMemberIds = new Set(billableMembers.map((member) => member.id));
  const currentAllocations = input.allocations.filter((allocation) =>
    allocation.matriculaId !== null && billableMemberIds.has(allocation.matriculaId),
  );
  const originalAmount = input.phase === 'RECURRING'
    ? input.payload.monthlyValue
    : input.payload.enrollmentFeeValue;
  if (originalAmount > 0 && currentAllocations.length === 0) {
    return { kind: 'REQUIRES_RECONCILIATION' };
  }

  const remainingAmount = Number(currentAllocations.reduce(
    (sum, allocation) => sum + Number(allocation.amount),
    0,
  ).toFixed(2));

  return {
    kind: 'PROCESS',
    totalAlunos: billableMembers.length,
    monthlyValue: input.phase === 'RECURRING' ? remainingAmount : input.payload.monthlyValue,
    enrollmentFeeValue: input.phase === 'ENROLLMENT_FEE'
      ? remainingAmount
      : input.payload.enrollmentFeeValue,
  };
}
import { getAcademicDateKey, getAcademicDateStartInstant, isAcademicDateInFuture } from '@alusa/shared/date-only';
