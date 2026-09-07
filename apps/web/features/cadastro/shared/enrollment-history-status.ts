import { isAcademicDateInFuture } from '@alusa/lib/date-only';

const UPCOMING_ENROLLMENT_STATUSES = new Set([
  'ATIVA',
  'AGUARDANDO_CONFIRMACAO',
  'PENDENTE_TAXA',
]);

export type EnrollmentHistoryStatusVariant =
  | 'default'
  | 'destructive'
  | 'outline'
  | 'warning'
  | 'info'
  | 'success'
  | 'neutral';

export function getEnrollmentHistoryStatusLabel(
  status: string,
  dataInicio: string | null | undefined,
  timeZone: string | null | undefined,
  now: Date = new Date(),
): string {
  const startsInFuture =
    dataInicio != null && isAcademicDateInFuture(dataInicio, now, timeZone ?? undefined);
  if (startsInFuture && UPCOMING_ENROLLMENT_STATUSES.has(status)) return 'Próxima';

  const labels: Record<string, string> = {
    ATIVA: 'Ativa',
    PAUSADA: 'Pausada',
    AGUARDANDO_CONFIRMACAO: 'Pendente',
    PENDENTE_TAXA: 'Taxa',
    ENCERRADA: 'Encerrada',
    CANCELADA: 'Cancelada',
  };
  return labels[status] ?? status;
}

export function getEnrollmentHistoryStatusVariant(
  status: string,
  dataInicio: string | null | undefined,
  timeZone: string | null | undefined,
  now: Date = new Date(),
): EnrollmentHistoryStatusVariant {
  const startsInFuture =
    dataInicio != null && isAcademicDateInFuture(dataInicio, now, timeZone ?? undefined);
  if (startsInFuture) return 'info';
  if (status === 'ATIVA') return 'success';
  if (status === 'CANCELADA' || status === 'RECUSADA') return 'destructive';
  if (status === 'PAUSADA' || status === 'PENDENTE_TAXA') return 'warning';
  if (status === 'ENCERRADA') return 'neutral';
  return 'info';
}
