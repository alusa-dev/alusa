'use client';

import { useEffect, useState } from 'react';
import { formatInstantInAccountZone, DEFAULT_ACCOUNT_TIMEZONE } from '@/lib/agenda-timezone';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { InfoCallout } from '@/components/ui/info-callout';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';
import type { CalendarEventDetailsDTO } from '@/features/lessons/dtos';
import { CALENDAR_EVENT_STATUS_OPTIONS, CALENDAR_EVENT_TYPE_OPTIONS } from '@/features/lessons/types';
import {
  evaluateAttendanceLaunchPolicy,
  getAttendanceLaunchPolicyMessage,
} from '@/features/lessons/utils/attendance-launch';
import {
  getCalendarEventTemporalBadge,
  getCalendarEventTemporalState,
  isCalendarEventPendingClosure,
} from '@/features/lessons/utils/calendar-event-state';
import { cn } from '@/lib/utils';
import { getAgendaEvent, updateAgendaEvent } from '@/features/lessons/agenda/services/agenda-service';

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
  return CALENDAR_EVENT_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

function formatEventStatus(status: CalendarEventDetailsDTO['status']) {
  return CALENDAR_EVENT_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

function formatRelatedStatus(status: string) {
  const labels: Record<string, string> = {
    AGENDADA: 'Agendada',
    REAGENDADA: 'Reagendada',
    REALIZADA: 'Realizada',
    CANCELADA: 'Cancelada',
  };

  return labels[status] ?? status;
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
        timeZone: eventTimeZone,
      })
    : null;
  const attendanceRosterAvailable = Boolean(
    event &&
      ((event.type === 'AULA' && event.turma) ||
        (event.type === 'REPOSICAO' && event.makeupsAsDestination.length > 0)),
  );
  const canRegisterAttendance = Boolean(
    event &&
      attendanceRosterAvailable &&
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
        <div className="flex h-full flex-col overflow-hidden bg-white alusa-dark:bg-[color:var(--color-bg-card)] sm:rounded-xl sm:border sm:border-slate-200 sm:shadow-sm alusa-dark:sm:border-[color:var(--color-border-default)] alusa-dark:sm:shadow-none">
          <div className="flex-1 overflow-y-auto bg-white px-6 pb-6 pt-12 alusa-dark:bg-[color:var(--color-bg-card)]">
            <div className="space-y-5">
          {loading ? (
            <div className="space-y-3 text-sm text-slate-500">Carregando evento...</div>
          ) : error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
              {error}
            </div>
          ) : event ? (
            <>
              <section className="space-y-3 border-b border-slate-200 pb-5 alusa-dark:border-[color:var(--color-border-default)]">
                <div className="space-y-1">
                  <h2 className="text-xs font-medium uppercase tracking-wide text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">Detalhes do evento</h2>
                  <p className="break-words text-xl font-semibold leading-7 text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">{event.title}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={getStatusVariant(event.status)}>{formatEventStatus(event.status)}</Badge>
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

              <section className="space-y-1">
                <ListCaption>Informações</ListCaption>
                <dl className="divide-y divide-slate-100 alusa-dark:divide-[color:var(--color-border-default)]">
                  <DetailRow
                    label="Data e horário"
                    value={`${formatInstantInAccountZone(event.startAt, 'dd/MM', eventTimeZone)} - ${formatInstantInAccountZone(event.startAt, 'HH:mm', eventTimeZone)} - ${formatInstantInAccountZone(event.endAt, 'HH:mm', eventTimeZone)}`}
                  />
                  <DetailRow label="Turma" value={event.turma?.label ?? 'Sem turma'} />
                  <DetailRow
                    label="Sala"
                    value={event.sala?.label ?? 'Sem sala'}
                  />
                  <DetailRow
                    label="Professor(es)"
                    value={
                      event.professores.length
                        ? event.professores.map((professor) => professor.nome).join(', ')
                        : 'Sem professor'
                    }
                  />
                </dl>
              </section>

              {event.experimental ? (
                <section className="space-y-1 border-t border-slate-200 pt-4 alusa-dark:border-[color:var(--color-border-default)]">
                  <ListCaption>Aula experimental</ListCaption>
                  <dl className="divide-y divide-slate-100 alusa-dark:divide-[color:var(--color-border-default)]">
                    <InfoListRow label="Aula experimental">
                      <Badge variant={getExperimentalStatusVariant(event.experimental.status)}>
                      {formatRelatedStatus(event.experimental.status)}
                      </Badge>
                    </InfoListRow>
                    <InfoListRow label="Aluno">{event.experimental.aluno.label}</InfoListRow>
                    {event.experimental.observacao ? (
                      <InfoListRow label="Observação">{event.experimental.observacao}</InfoListRow>
                    ) : null}
                  </dl>
                </section>
              ) : null}

              {event.description ? (
                <section className="border-t border-slate-200 pt-4 alusa-dark:border-[color:var(--color-border-default)]">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">Descrição</div>
                    <p className="mt-1 break-words text-sm leading-6 text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">{event.description}</p>
                  </div>
                </section>
              ) : null}

              {attendanceRosterAvailable && event.attendanceSummary ? (
                <section className="space-y-1 border-t border-slate-200 pt-4 alusa-dark:border-[color:var(--color-border-default)]">
                  <ListCaption>Frequência</ListCaption>
                  <dl className="divide-y divide-slate-100 alusa-dark:divide-[color:var(--color-border-default)]">
                    <InfoListRow label="Elegíveis">{event.attendanceSummary.totalEligible}</InfoListRow>
                    <InfoListRow label="Registrados">{event.attendanceSummary.recorded}</InfoListRow>
                    <InfoListRow label="Presentes">{event.attendanceSummary.presente}</InfoListRow>
                    <InfoListRow label="Faltas">
                      {event.attendanceSummary.falta + event.attendanceSummary.faltaJustificada}
                    </InfoListRow>
                  </dl>
                </section>
              ) : null}

              {pendingClosure ? (
                <section className="border-t border-amber-200 pt-4 text-amber-800 alusa-dark:border-amber-900 alusa-dark:text-amber-200">
                  <div className="text-sm font-semibold text-amber-900 alusa-dark:text-amber-100">Fechamento pendente</div>
                  <p className="mt-1 text-sm leading-6">
                    Este evento ja passou do horario e continua agendado. O sistema preserva o status operacional
                    ate uma acao explicita para evitar conclusao automatica incorreta.
                  </p>
                </section>
              ) : null}

              {temporalState === 'in_progress' ? (
                <section className="border-t border-sky-200 pt-4 text-sky-800 alusa-dark:border-sky-900 alusa-dark:text-sky-200">
                  <div className="text-sm font-semibold text-sky-900 alusa-dark:text-sky-100">Evento em andamento</div>
                  <p className="mt-1 text-sm leading-6">
                    Durante a execucao, priorize registro de frequencia e fechamento operacional. Edicoes estruturais
                    e cancelamento ficam bloqueados para evitar conflito de operacao.
                  </p>
                </section>
              ) : null}

              {event.conflicts.length ? (
                <section className="border-t border-amber-200 pt-4 alusa-dark:border-amber-900">
                  <div className="text-sm font-semibold text-amber-900 alusa-dark:text-amber-100">
                    Conflitos detectados
                  </div>
                  <ul className="mt-2 divide-y divide-amber-200 text-sm text-amber-800 alusa-dark:divide-amber-900 alusa-dark:text-amber-200">
                    {event.conflicts.map((conflict) => (
                      <li className="py-2 first:pt-0" key={`${conflict.type}-${conflict.relatedEventId ?? 'none'}-${conflict.message}`}>
                        {conflict.message}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {event.makeupsAsOrigin.length ? (
                <section className="space-y-1 border-t border-slate-200 pt-4 alusa-dark:border-[color:var(--color-border-default)]">
                  <ListCaption>Reposições</ListCaption>
                  <dl className="divide-y divide-slate-100 alusa-dark:divide-[color:var(--color-border-default)]">
                    {event.makeupsAsOrigin.map((item) => (
                      <InfoListRow key={item.id} label="Reposição originada">
                        <span className="flex flex-wrap items-center justify-end gap-2">
                          <span>{item.scope}</span>
                          <Badge variant="outline">{formatRelatedStatus(item.status)}</Badge>
                        </span>
                      </InfoListRow>
                    ))}
                  </dl>
                </section>
              ) : null}

              {event.makeupsAsDestination.length ? (
                <section className="space-y-1 border-t border-slate-200 pt-4 alusa-dark:border-[color:var(--color-border-default)]">
                  <ListCaption>Reposições</ListCaption>
                  <dl className="divide-y divide-slate-100 alusa-dark:divide-[color:var(--color-border-default)]">
                    {event.makeupsAsDestination.map((item) => (
                      <InfoListRow key={item.id} label="Reposição atendida">
                        <span className="flex flex-wrap items-center justify-end gap-2">
                          <span>{item.scope}</span>
                          <Badge variant="outline">{formatRelatedStatus(item.status)}</Badge>
                        </span>
                      </InfoListRow>
                    ))}
                  </dl>
                </section>
              ) : null}

              {attendanceRosterAvailable && event && !canRegisterAttendance && attendanceLaunchPolicy ? (
                <InfoCallout variant="warning" size="sm">
                  {getAttendanceLaunchPolicyMessage(attendanceLaunchPolicy.reason) ??
                    'A frequência não está disponível para esta ocorrência no momento.'}
                </InfoCallout>
              ) : null}
            </>
          ) : null}
            </div>
        </div>

        <div className="border-t border-slate-100 bg-white px-6 py-5 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card)]">
          <div className="space-y-3">
          {canRegisterAttendance && event ? (
            <Button
              className="h-10 w-full rounded-lg bg-primary text-primary-foreground shadow-none hover:bg-primary/90"
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

function ListCaption({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="pb-1 text-xs font-medium uppercase tracking-wide text-slate-500 alusa-dark:text-[color:var(--color-text-muted)]">
      {children}
    </h3>
  );
}

function InfoListRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(7rem,0.8fr)_minmax(0,1.6fr)] items-start gap-4 py-3">
      <dt className="text-sm font-medium leading-5 text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">{label}</dt>
      <dd className="min-w-0 break-words text-right text-sm font-medium leading-5 text-slate-800 alusa-dark:text-[color:var(--color-text-primary)]">{children}</dd>
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(7rem,0.8fr)_minmax(0,1.6fr)] items-start gap-4 py-3">
      <dt className="min-w-0 text-sm font-medium leading-5 text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">{label}</dt>
      <dd className="min-w-0 break-words text-right text-sm font-medium leading-5 text-slate-800 alusa-dark:text-[color:var(--color-text-primary)]">{value}</dd>
    </div>
  );
}
