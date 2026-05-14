'use client';

import { useMemo, useState } from 'react';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { DashboardAulaExperimentalDTO } from '@/features/dashboard/dtos';
import { cn } from '@/lib/cn';
import { DASHBOARD_SECTION_CARD_CLASSNAME } from './utils';

type AulaExperimentalCardProps = {
  aulasExperimentais: DashboardAulaExperimentalDTO[];
};

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'AE';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function isSameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function getEventDate(startAt: string) {
  return startOfDay(new Date(startAt));
}

function getClassesForDate(aulasExperimentais: DashboardAulaExperimentalDTO[], date: Date) {
  return aulasExperimentais.filter((aula) => isSameDay(getEventDate(aula.startAt), date));
}

function getCalendarDates(aulasExperimentais: DashboardAulaExperimentalDTO[]) {
  const uniqueDates = new Map<number, Date>();

  for (const aula of aulasExperimentais) {
    const eventDate = getEventDate(aula.startAt);
    uniqueDates.set(eventDate.getTime(), new Date(
      eventDate.getFullYear(),
      eventDate.getMonth(),
      eventDate.getDate(),
      12,
      0,
      0,
      0,
    ));
  }

  return Array.from(uniqueDates.values()).sort((first, second) => first.getTime() - second.getTime());
}

function formatDayLabel(date: Date) {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  }).format(date);
}

function formatTimeLabel(value: string) {
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function getStatusLabel(status: DashboardAulaExperimentalDTO['status']) {
  switch (status) {
    case 'REALIZADA':
      return 'Realizada';
    case 'REAGENDADA':
      return 'Reagendada';
    case 'CANCELADA':
      return 'Cancelada';
    case 'AGENDADA':
    default:
      return 'Agendada';
  }
}

function getStatusClassName(status: DashboardAulaExperimentalDTO['status']) {
  switch (status) {
    case 'REALIZADA':
      return 'bg-emerald-50 text-emerald-700 alusa-dark:bg-emerald-950/35 alusa-dark:text-emerald-300';
    case 'REAGENDADA':
      return 'bg-amber-50 text-amber-700 alusa-dark:bg-amber-950/40 alusa-dark:text-amber-300';
    case 'CANCELADA':
      return 'bg-rose-50 text-rose-700 alusa-dark:bg-rose-950/40 alusa-dark:text-rose-300';
    case 'AGENDADA':
    default:
      return 'bg-[#f4ecfd] text-[#4c1d95] alusa-dark:bg-[color:rgba(169,77,255,0.16)] alusa-dark:text-[color:#c9a7ff]';
  }
}

function getFirstDateForMonth(aulasExperimentais: DashboardAulaExperimentalDTO[], month: Date) {
  const monthStart = startOfMonth(month);
  return aulasExperimentais.find((aula) => {
    const eventDate = getEventDate(aula.startAt);
    return (
      eventDate.getFullYear() === monthStart.getFullYear() &&
      eventDate.getMonth() === monthStart.getMonth()
    );
  });
}

export function AulaExperimentalCard({ aulasExperimentais }: AulaExperimentalCardProps) {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [viewMonth, setViewMonth] = useState(startOfMonth(today));
  const [selectedDate, setSelectedDate] = useState(today);

  const aulasHoje = useMemo(
    () => getClassesForDate(aulasExperimentais, today),
    [aulasExperimentais, today],
  );
  const aulasSelecionadas = useMemo(
    () => getClassesForDate(aulasExperimentais, selectedDate),
    [aulasExperimentais, selectedDate],
  );
  const highlightedDates = useMemo(
    () => getCalendarDates(aulasExperimentais),
    [aulasExperimentais],
  );

  const visibleClasses = aulasHoje.slice(0, 3);
  const remainingCount = Math.max(0, aulasHoje.length - visibleClasses.length);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`${DASHBOARD_SECTION_CARD_CLASSNAME} flex h-full w-full flex-col justify-between rounded-2xl bg-white px-5 py-4 text-left transition-colors hover:bg-gray-50/60 focus:ring-0 focus:ring-offset-0 focus-visible:ring-2 focus-visible:ring-brand-accent/35 focus-visible:ring-offset-0 alusa-dark:bg-[color:var(--color-bg-card)] alusa-dark:hover:bg-white/[0.04]`}
        >
          <div>
            <p className="text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">Aula Experimental</p>
            <p className="mt-1 text-xs capitalize text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">{formatDayLabel(today)}</p>
          </div>

          <div className="mt-4 flex-1 space-y-2.5">
            {visibleClasses.length === 0 ? (
              <p className="text-sm leading-6 text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">Nenhuma aula experimental agendada para hoje.</p>
            ) : (
              visibleClasses.map((aula) => (
                <div key={aula.id} className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#f4ecfd] text-[11px] font-semibold text-[#383242] alusa-dark:bg-[color:var(--color-bg-card-soft)] alusa-dark:text-[color:var(--color-text-primary)]">
                    {aula.alunoFoto ? (
                      <img src={aula.alunoFoto} alt={aula.alunoNome} className="h-full w-full object-cover" />
                    ) : (
                      <span>{getInitials(aula.alunoNome)}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">{aula.alunoNome}</p>
                    <p className="truncate text-xs text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">
                      {aula.turmaNome} • {formatTimeLabel(aula.startAt)}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${getStatusClassName(aula.status)}`}>
                    {getStatusLabel(aula.status)}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="mt-4 flex items-center justify-between text-xs text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">
            <span>{remainingCount > 0 ? `+${remainingCount} para ver` : 'Clique para abrir'}</span>
            <span className="font-medium text-[#383242] alusa-dark:text-[color:var(--color-brand-300)]">Ver agenda</span>
          </div>
        </button>
      </DialogTrigger>

      <DialogContent
        fullScreenMobile
        className={cn(
          'max-w-[850px] gap-0 overflow-hidden p-0 data-[state=open]:animate-modal-expand-in data-[state=closed]:animate-modal-shrink-out sm:max-w-[850px] alusa-dark:border-[color:rgba(148,146,209,0.14)] alusa-dark:bg-[color:var(--color-bg-card)]',
          'max-md:flex max-md:min-h-0 max-md:flex-col max-md:p-0 max-md:gap-0',
        )}
      >
        <DialogHeader className="relative border-b border-gray-100 px-6 py-5 text-left max-md:shrink-0 max-md:space-y-0 max-md:px-4 max-md:py-4 max-md:pb-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))] alusa-dark:border-[color:rgba(148,146,209,0.14)]">
          <span className="pointer-events-none absolute inset-x-0 top-0 hidden h-px bg-gradient-to-r from-transparent via-brand-accent/40 to-transparent max-md:block" />
          <div>
            <DialogTitle className="pr-2 text-base font-semibold text-slate-900 md:pr-0 alusa-dark:text-[color:var(--color-text-primary)]">Aulas experimentais</DialogTitle>
            <p className="mt-1 text-left text-sm text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
              Selecione um dia para ver as aulas experimentais agendadas e navegue pelos próximos meses.
            </p>
          </div>
        </DialogHeader>

        <div className="max-md:flex max-md:min-h-0 max-md:flex-1 max-md:flex-col max-md:overflow-hidden md:block md:overflow-visible">
          <div className="max-md:min-h-0 max-md:flex-1 max-md:overflow-y-auto md:overflow-visible">
            <div className="flex flex-col sm:flex-row">
              <div className="flex flex-col items-center border-b border-gray-100 p-6 max-md:w-full max-md:min-w-0 max-md:px-5 max-md:py-4 sm:w-[340px] sm:shrink-0 sm:border-b-0 sm:border-r alusa-dark:border-[color:rgba(148,146,209,0.14)]">
                <div className="w-fit max-md:w-full max-md:max-w-[21rem] max-md:min-w-0">
                  <Calendar
                    mode="single"
                    month={viewMonth}
                    onMonthChange={(date) => {
                      const nextMonth = startOfMonth(date);
                      const firstDateInMonth = getFirstDateForMonth(aulasExperimentais, nextMonth);
                      setViewMonth(nextMonth);
                      setSelectedDate(firstDateInMonth ? getEventDate(firstDateInMonth.startAt) : nextMonth);
                    }}
                    selected={selectedDate}
                    onSelect={(date) => {
                      if (!date) return;
                      setSelectedDate(startOfDay(date));
                      setViewMonth(startOfMonth(date));
                    }}
                    showOutsideDays
                    modifiers={{ experimental: highlightedDates }}
                    modifiersClassNames={{
                      experimental: 'alusa-calendar-event-day',
                    }}
                    className="bg-transparent p-0 [--cell-size:2.1rem] max-md:w-full max-md:min-w-0 max-md:[--cell-size:2.25rem]"
                    classNames={{
                      caption_label:
                        'text-sm font-semibold tracking-tight text-slate-900 capitalize alusa-dark:text-[color:var(--color-text-primary)]',
                      weekdays: 'flex w-full max-md:!table-row max-md:h-8',
                      week: 'mt-2 flex w-full max-md:!table-row max-md:!mt-0',
                      month_grid: 'w-full border-collapse max-md:table-fixed',
                      weekday:
                        'select-none text-[13px] font-medium text-slate-400 capitalize text-center max-md:!table-cell max-md:text-[11px] md:w-[--cell-size] md:flex-none alusa-dark:text-[color:rgba(237,239,255,0.45)]',
                      day:
                        'group/day relative aspect-square h-full w-full select-none p-0 text-center max-md:!table-cell max-md:h-[--cell-size] max-md:w-[--cell-size] max-md:align-middle max-md:[&_button]:mx-auto max-md:[&_button]:h-8 max-md:[&_button]:w-8 max-md:[&_button]:text-[11px]',
                      today: 'alusa-calendar-today-day',
                    }}
                  />
                </div>

                <div className="mt-5 flex w-full flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-slate-500 max-md:mt-4 max-md:gap-x-4 max-md:text-[11px] alusa-dark:text-[color:var(--color-text-secondary)]">
                  <span className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-[#f4ecfd] alusa-dark:bg-[color:rgba(201,167,255,0.45)]" />
                    Dia com aula experimental
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-[#8b5cf6]" />
                    Hoje
                  </span>
                </div>
              </div>

              <div className="flex min-h-[380px] flex-1 flex-col bg-slate-50/50 p-6 max-md:min-h-0 alusa-dark:bg-[color:rgba(21,22,30,0.55)]">
                <div className="mb-4">
                  <p className="text-sm font-semibold capitalize text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">
                    Aulas de {formatDayLabel(selectedDate)}
                  </p>
                  <p className="mt-1 text-sm text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
                    {aulasSelecionadas.length === 0
                      ? 'Nenhuma aula experimental neste dia.'
                      : `${aulasSelecionadas.length} aula${aulasSelecionadas.length > 1 ? 's' : ''} experimental${aulasSelecionadas.length > 1 ? 'is' : ''} neste dia.`}
                  </p>
                </div>

                <div className="max-h-[228px] space-y-2.5 overflow-y-auto pr-1 max-md:max-h-none max-md:flex-1 max-md:overflow-visible max-md:pr-0 sm:max-h-[228px] sm:flex-none sm:overflow-y-auto">
                  {aulasSelecionadas.length === 0 ? (
                    <div className="alusa-dialog-empty-slot flex h-full min-h-[160px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-4 text-center text-sm text-slate-500 alusa-dark:border-[color:rgba(148,146,209,0.22)] alusa-dark:bg-[color:rgba(21,22,30,0.5)] alusa-dark:text-[color:var(--color-text-secondary)]">
                      Nenhuma aula experimental cadastrada para a data selecionada.
                    </div>
                  ) : (
                    aulasSelecionadas.map((aula) => (
                      <div
                        key={aula.id}
                        className="alusa-dialog-list-row-slot flex items-center gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] max-md:flex-col max-md:items-stretch max-md:gap-2 alusa-dark:border-[color:rgba(148,146,209,0.14)] alusa-dark:bg-[color:var(--color-bg-card-soft)] alusa-dark:shadow-none"
                      >
                        <div className="flex min-w-0 flex-1 items-start gap-3 md:items-center">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#f4ecfd] text-xs font-semibold text-[#4c1d95] alusa-dark:bg-[color:rgba(169,77,255,0.16)] alusa-dark:text-[color:#c9a7ff]">
                            {aula.alunoFoto ? (
                              <img src={aula.alunoFoto} alt={aula.alunoNome} className="h-full w-full object-cover" />
                            ) : (
                              <span>{getInitials(aula.alunoNome)}</span>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium leading-tight text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">{aula.alunoNome}</p>
                            <p className="mt-0.5 text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
                              {aula.turmaNome} • {formatTimeLabel(aula.startAt)} - {formatTimeLabel(aula.endAt)}
                            </p>
                          </div>
                        </div>

                        <span className={`inline-flex w-fit shrink-0 rounded-full px-2.5 py-1 text-xs font-medium max-md:self-start max-md:ml-[calc(2.5rem+0.75rem)] ${getStatusClassName(aula.status)}`}>
                          {getStatusLabel(aula.status)}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
