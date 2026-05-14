'use client';

import { useEffect, useState } from 'react';
import { formatInstantInAccountZone, DEFAULT_ACCOUNT_TIMEZONE } from '@/lib/agenda-timezone';
import { ptBR } from 'date-fns/locale';

import { BookOpen, Clock, DocumentText, MapPin, User, Warning } from '@/components/icons/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import type { CalendarEventDetailsDTO } from '@/features/aulas/dtos';
import {
  evaluateAttendanceLaunchPolicy,
  getAttendanceLaunchPolicyMessage,
} from '@/features/aulas/utils/attendance-launch';
import {
  getCalendarEventTemporalBadge,
  getCalendarEventTemporalState,
  isCalendarEventPendingClosure,
} from '@/features/aulas/utils/calendar-event-state';
import { cn } from '@/lib/utils';
import { getAgendaEvent, updateAgendaEvent } from '@/features/aulas/agenda/services/agenda-service';

type CalendarEventSheetProps = {
  open: boolean;
  eventId: string | null;
  onOpenChange: (_open: boolean) => void;
  onRefresh: () => void;
  onRequestEdit: (_event: CalendarEventDetailsDTO) => void;
  onGoToAttendance: (_eventId: string) => void;
};

function getStatusVariant(status: CalendarEventDetailsDTO['status']) {
  if (status === 'REALIZADO') return 'success';
  if (status === 'CANCELADO') return 'neutral';
  return 'info';
}

function getExperimentalStatusVariant(status: NonNullable<CalendarEventDetailsDTO['experimental']>['status']) {
  if (status === 'REALIZADA') return 'success';
  if (status === 'CANCELADA') return 'neutral';
  if (status === 'REAGENDADA') return 'warning';
  return 'info';
}

function formatEventType(type: CalendarEventDetailsDTO['type']) {
  return type.toLowerCase().replace(/_/g, ' ');
}

export function CalendarEventSheet({
  open,
  eventId,
  onOpenChange,
  onRefresh,
  onRequestEdit,
  onGoToAttendance,
}: CalendarEventSheetProps) {
  const [event, setEvent] = useState<CalendarEventDetailsDTO | null>(null);
  const [eventTimeZone, setEventTimeZone] = useState(DEFAULT_ACCOUNT_TIMEZONE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updatingStatus, setUpdatingStatus] = useState<CalendarEventDetailsDTO['status'] | null>(null);
  const temporalState = event ? getCalendarEventTemporalState(event) : null;
  const temporalBadge = event ? getCalendarEventTemporalBadge(event) : null;
  const pendingClosure = event ? isCalendarEventPendingClosure(event) : false;
  const attendanceLaunchPolicy = event
    ? evaluateAttendanceLaunchPolicy({
        startAt: event.startAt,
        status: event.status,
      })
    : null;
  const canRegisterAttendance = Boolean(
    event &&
      (event.type === 'AULA' || event.type === 'REPOSICAO') &&
      attendanceLaunchPolicy?.allowed,
  );
  const canEdit = Boolean(event && event.status === 'AGENDADO' && (temporalState === 'future' || temporalState === 'today'));
  const canMarkAsDone = Boolean(event && event.status === 'AGENDADO' && (temporalState === 'in_progress' || pendingClosure));
  const canCancel = Boolean(event && event.status === 'AGENDADO' && (temporalState === 'future' || temporalState === 'today'));
  const secondaryActionsCount =
    (canEdit ? 1 : 0) + (canMarkAsDone ? 1 : 0) + (canCancel ? 1 : 0);

  useEffect(() => {
    if (!open || !eventId) {
      setEvent(null);
      setEventTimeZone(DEFAULT_ACCOUNT_TIMEZONE);
      setError(null);
      return;
    }

    let cancelled = false;

    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await getAgendaEvent(eventId);
        if (!cancelled) {
          setEvent(result.data);
          setEventTimeZone(result.timeZone);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [open, eventId]);

  async function handleUpdateStatus(status: CalendarEventDetailsDTO['status']) {
    if (!eventId) return;

    try {
      setUpdatingStatus(status);
      await updateAgendaEvent(eventId, { status });
      onRefresh();
      const result = await getAgendaEvent(eventId);
      setEvent(result.data);
      setEventTimeZone(result.timeZone);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUpdatingStatus(null);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="overflow-hidden border-0 bg-transparent p-0 shadow-none sm:inset-y-4 sm:right-4 sm:h-[calc(100vh-32px)] sm:max-w-[430px]"
      >
        <SheetTitle className="sr-only">Detalhes do evento da agenda</SheetTitle>
        <SheetDescription className="sr-only">
          Visualize dados do evento, acompanhe conflitos e execute ações operacionais da agenda.
        </SheetDescription>
        <div className="flex h-full flex-col overflow-hidden bg-white alusa-dark:bg-[color:var(--color-bg-card)] sm:rounded-2xl sm:border sm:border-slate-200 sm:shadow-[0_20px_60px_rgba(15,23,42,0.18)] alusa-dark:sm:border-[color:var(--color-border-default)] alusa-dark:sm:shadow-none">
          <div className="flex-1 overflow-y-auto bg-white px-6 pb-6 pt-12 alusa-dark:bg-[color:var(--color-bg-card)]">
            <div className="space-y-5">
          {loading ? (
            <div className="space-y-3 text-sm text-slate-500">Carregando evento...</div>
          ) : error ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : event ? (
            <>
              <section className="space-y-3 text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100 alusa-dark:bg-[color:var(--color-bg-card-soft)]">
                  <BookOpen className="h-7 w-7 text-slate-500 alusa-dark:text-[color:var(--color-text-muted)]" />
                </div>

                <div className="space-y-1">
                  <h2 className="text-sm font-medium text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">Detalhes do evento</h2>
                  <p className="text-[30px] font-semibold tracking-[-0.03em] text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">
                    {formatInstantInAccountZone(event.startAt, 'HH:mm', eventTimeZone)}
                    {' - '}
                    {formatInstantInAccountZone(event.endAt, 'HH:mm', eventTimeZone)}
                  </p>
                  <p className="text-xs text-slate-400 alusa-dark:text-[color:var(--color-text-muted)]">
                    {formatInstantInAccountZone(event.startAt, "dd 'de' MMMM", eventTimeZone, { locale: ptBR })}
                    {' · '}
                    {event.title}
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Badge variant={getStatusVariant(event.status)}>{event.status}</Badge>
                  {temporalBadge ? (
                    <Badge
                      variant={
                        temporalBadge.tone === 'warning'
                          ? 'warning'
                          : temporalBadge.tone === 'info'
                            ? 'info'
                            : 'neutral'
                      }
                    >
                      {temporalBadge.label}
                    </Badge>
                  ) : null}
                  <Badge variant="outline">{formatEventType(event.type)}</Badge>
                  {event.conflicts.length ? (
                    <Badge variant="warning">{event.conflicts.length} conflito(s)</Badge>
                  ) : null}
                </div>
              </section>

              <section className="rounded-xl border border-slate-200 bg-white alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
                <div className="divide-y divide-slate-100 alusa-dark:divide-[color:var(--color-border-default)]">
                  <DetailRow
                    label="Quando"
                    value={`${formatInstantInAccountZone(event.startAt, "dd 'de' MMMM, HH:mm", eventTimeZone, { locale: ptBR })} - ${formatInstantInAccountZone(event.endAt, 'HH:mm', eventTimeZone, { locale: ptBR })}`}
                    icon={Clock}
                  />
                  <DetailRow
                    label="Turma"
                    value={event.turma?.label ?? 'Sem turma'}
                    icon={BookOpen}
                  />
                  <DetailRow
                    label="Sala"
                    value={event.sala?.label ?? 'Sem sala'}
                    icon={MapPin}
                  />
                  <DetailRow
                    label="Professor(es)"
                    value={
                      event.professores.length
                        ? event.professores.map((professor) => professor.nome).join(', ')
                        : 'Sem professor'
                    }
                    icon={User}
                  />
                </div>
              </section>

              {event.experimental ? (
                <section className="rounded-xl border border-slate-200 bg-white p-5 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">Aula experimental</div>
                      <p className="mt-1 text-sm text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">Aluno: {event.experimental.aluno.label}</p>
                    </div>
                    <Badge variant={getExperimentalStatusVariant(event.experimental.status)}>
                      {event.experimental.status}
                    </Badge>
                  </div>

                  {event.experimental.observacao ? (
                    <p className="mt-3 text-sm leading-6 text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">{event.experimental.observacao}</p>
                  ) : null}
                </section>
              ) : null}

              {event.description ? (
                <section className="rounded-xl border border-slate-200 bg-white alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
                  <div className="flex items-start gap-3 px-5 py-4">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400 alusa-dark:bg-[color:var(--color-bg-card-soft)] alusa-dark:text-[color:var(--color-text-muted)]">
                      <DocumentText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">Descrição</div>
                      <p className="mt-1 text-sm leading-6 text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">{event.description}</p>
                    </div>
                  </div>
                </section>
              ) : null}

              {event.attendanceSummary ? (
                <section className="rounded-xl border border-slate-200 bg-white p-5 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
                  <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-400 alusa-dark:text-[color:var(--color-text-muted)]">Elegíveis</div>
                    <div className="mt-1 text-xl font-semibold text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">
                      {event.attendanceSummary.totalEligible}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-400 alusa-dark:text-[color:var(--color-text-muted)]">Registrados</div>
                    <div className="mt-1 text-xl font-semibold text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">
                      {event.attendanceSummary.recorded}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-400 alusa-dark:text-[color:var(--color-text-muted)]">Presentes</div>
                    <div className="mt-1 text-base font-semibold text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">
                      {event.attendanceSummary.presente}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-slate-400 alusa-dark:text-[color:var(--color-text-muted)]">Faltas</div>
                    <div className="mt-1 text-base font-semibold text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">
                      {event.attendanceSummary.falta + event.attendanceSummary.faltaJustificada}
                    </div>
                  </div>
                  </div>
                </section>
              ) : null}

              {pendingClosure ? (
                <section className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
                  <div className="text-sm font-semibold text-amber-900">Fechamento pendente</div>
                  <p className="mt-1 text-sm leading-6 text-amber-800">
                    Este evento ja passou do horario e continua agendado. O sistema preserva o status operacional
                    ate uma acao explicita para evitar conclusao automatica incorreta.
                  </p>
                </section>
              ) : null}

              {temporalState === 'in_progress' ? (
                <section className="rounded-xl border border-sky-200 bg-sky-50 px-5 py-4">
                  <div className="text-sm font-semibold text-sky-900">Evento em andamento</div>
                  <p className="mt-1 text-sm leading-6 text-sky-800">
                    Durante a execucao, priorize registro de frequencia e fechamento operacional. Edicoes estruturais
                    e cancelamento ficam bloqueados para evitar conflito de operacao.
                  </p>
                </section>
              ) : null}

              {event.conflicts.length ? (
                <section className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                      <Warning className="h-4 w-4" />
                    </div>
                    <div className="text-sm font-semibold text-amber-900">Conflitos detectados</div>
                  </div>
                  <ul className="mt-2 space-y-2 text-sm text-amber-800">
                    {event.conflicts.map((conflict) => (
                      <li key={`${conflict.type}-${conflict.relatedEventId ?? 'none'}-${conflict.message}`}>
                        {conflict.message}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {event.makeupsAsOrigin.length ? (
                <section className="rounded-xl border border-slate-200 bg-white p-5 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
                  <div className="text-sm font-semibold text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">Reposições originadas aqui</div>
                  <div className="mt-2 space-y-2">
                    {event.makeupsAsOrigin.map((item) => (
                      <div key={item.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm alusa-dark:bg-[color:var(--color-bg-card-soft)] alusa-dark:text-[color:var(--color-text-secondary)]">
                        <span>{item.scope}</span>
                        <Badge variant="outline">{item.status}</Badge>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {event.makeupsAsDestination.length ? (
                <section className="rounded-xl border border-slate-200 bg-white p-5 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
                  <div className="text-sm font-semibold text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">Reposições atendidas neste evento</div>
                  <div className="mt-2 space-y-2">
                    {event.makeupsAsDestination.map((item) => (
                      <div key={item.id} className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm alusa-dark:bg-[color:var(--color-bg-card-soft)] alusa-dark:text-[color:var(--color-text-secondary)]">
                        <span>{item.scope}</span>
                        <Badge variant="outline">{item.status}</Badge>
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}

              {event && !canRegisterAttendance && attendanceLaunchPolicy ? (
                <section className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
                  {getAttendanceLaunchPolicyMessage(attendanceLaunchPolicy.reason) ??
                    'A frequência não está disponível para esta ocorrência no momento.'}
                </section>
              ) : null}
            </>
          ) : null}
            </div>
        </div>

        <div className="border-t border-slate-100 bg-white px-6 py-5 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
          <div className="space-y-3">
          {canRegisterAttendance && event ? (
            <Button
              className="h-10 w-full rounded-lg bg-brand-accent text-sm font-medium text-white hover:bg-brand-accent/90"
              onClick={() => onGoToAttendance(event.id)}
              data-testid="agenda-event-go-attendance"
            >
              Registrar frequência
            </Button>
          ) : null}
          {secondaryActionsCount > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {canEdit && event ? (
                <Button
                  variant="outline"
                  className={cn(
                    'h-10 w-full rounded-lg border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-100 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-transparent alusa-dark:text-[color:var(--color-text-secondary)] alusa-dark:hover:bg-[color:rgba(255,255,255,0.05)] alusa-dark:hover:text-[color:var(--color-text-primary)]',
                    secondaryActionsCount === 1 && 'col-span-2',
                  )}
                  onClick={() => onRequestEdit(event)}
                >
                  Editar
                </Button>
              ) : null}
              {canMarkAsDone ? (
                <Button
                  variant="outline"
                  className={cn(
                    'h-10 w-full rounded-lg border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-100 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-transparent alusa-dark:text-[color:var(--color-text-secondary)] alusa-dark:hover:bg-[color:rgba(255,255,255,0.05)] alusa-dark:hover:text-[color:var(--color-text-primary)]',
                    secondaryActionsCount === 1 && 'col-span-2',
                    secondaryActionsCount === 3 && !canCancel && 'col-span-2',
                  )}
                  onClick={() => handleUpdateStatus('REALIZADO')}
                  disabled={updatingStatus !== null}
                  data-testid="agenda-event-mark-realizado"
                >
                  {updatingStatus === 'REALIZADO' ? 'Atualizando...' : 'Marcar como realizado'}
                </Button>
              ) : null}
              {canCancel ? (
                <Button
                  variant="outline"
                  className={cn(
                    'h-10 w-full rounded-lg border-slate-200 text-sm font-medium text-rose-700 hover:bg-rose-50 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-transparent alusa-dark:text-rose-300 alusa-dark:hover:bg-rose-500/10 alusa-dark:hover:text-rose-200',
                    secondaryActionsCount % 2 === 1 && 'col-span-2',
                  )}
                  onClick={() => handleUpdateStatus('CANCELADO')}
                  disabled={updatingStatus !== null}
                  data-testid="agenda-event-cancel"
                >
                  {updatingStatus === 'CANCELADO' ? 'Cancelando...' : 'Cancelar evento'}
                </Button>
              ) : null}
            </div>
          ) : null}
          </div>
        </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DetailRow({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-4">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400 alusa-dark:bg-[color:var(--color-bg-card-soft)] alusa-dark:text-[color:var(--color-text-muted)]">
          <Icon className="h-4 w-4" />
        </div>
        <span className="min-w-0 text-sm font-medium leading-5 text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">{label}</span>
      </div>
      <span
        className={cn(
          'max-w-[58%] break-words text-right text-sm font-semibold leading-5 text-slate-700 alusa-dark:text-[color:var(--color-text-primary)]',
          label === 'Professor(es)' && 'max-w-[62%]',
        )}
      >
        {value}
      </span>
    </div>
  );
}
