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

const MONTH_NAMES = [
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

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

function getMonthLabel(date: Date) {
  return MONTH_NAMES[date.getMonth()];
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
      return 'bg-emerald-50 text-emerald-700';
    case 'REAGENDADA':
      return 'bg-amber-50 text-amber-700';
    case 'CANCELADA':
      return 'bg-rose-50 text-rose-700';
    case 'AGENDADA':
    default:
      return 'bg-[#f4ecfd] text-[#4c1d95]';
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
          className="flex h-full w-full flex-col justify-between rounded-2xl border border-gray-200 bg-white px-5 py-4 text-left shadow-sm transition-colors hover:bg-gray-50/60"
        >
          <div>
            <p className="text-sm font-semibold text-gray-900">Aula Experimental</p>
            <p className="mt-1 text-xs capitalize text-gray-500">{formatDayLabel(today)}</p>
          </div>

          <div className="mt-4 flex-1 space-y-2.5">
            {visibleClasses.length === 0 ? (
              <p className="text-sm leading-6 text-gray-500">Nenhuma aula experimental agendada para hoje.</p>
            ) : (
              visibleClasses.map((aula) => (
                <div key={aula.id} className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#f4ecfd] text-[11px] font-semibold text-[#383242]">
                    {aula.alunoFoto ? (
                      <img src={aula.alunoFoto} alt={aula.alunoNome} className="h-full w-full object-cover" />
                    ) : (
                      <span>{getInitials(aula.alunoNome)}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{aula.alunoNome}</p>
                    <p className="truncate text-xs text-gray-500">
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

          <div className="mt-4 flex items-center justify-between text-xs text-gray-500">
            <span>{remainingCount > 0 ? `+${remainingCount} para ver` : 'Clique para abrir'}</span>
            <span className="font-medium text-[#383242]">Ver agenda</span>
          </div>
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-[850px] gap-0 overflow-hidden p-0 data-[state=open]:animate-modal-expand-in data-[state=closed]:animate-modal-shrink-out sm:max-w-[850px]">
        <DialogHeader className="border-b border-gray-100 px-6 py-5 text-left">
          <div>
            <DialogTitle className="text-base font-semibold text-slate-900">Aulas experimentais</DialogTitle>
            <p className="mt-1 text-sm text-slate-500">
              Selecione um dia para ver as aulas experimentais agendadas e navegue pelos próximos meses.
            </p>
          </div>
        </DialogHeader>

        <div className="flex flex-col sm:flex-row">
          <div className="flex flex-col items-center border-b border-gray-100 p-6 sm:w-[340px] sm:shrink-0 sm:border-b-0 sm:border-r">
            <div className="w-fit">
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
                  experimental:
                    'text-[#4c1d95] font-semibold [&_button]:bg-[#f4ecfd] [&_button]:text-[#4c1d95] [&_button]:font-semibold [&_button]:rounded-lg [&_button]:scale-75',
                }}
                className="bg-transparent p-0 [--cell-size:2.1rem]"
                classNames={{
                  caption_label: 'text-sm font-semibold tracking-tight text-slate-900 capitalize',
                  weekday: 'select-none text-[13px] font-medium text-slate-400 capitalize w-[--cell-size] text-center',
                  day: 'p-0',
                  today:
                    'text-white [&_button]:bg-[#8b5cf6] [&_button]:text-white [&_button]:font-semibold [&_button]:rounded-lg [&_button]:scale-90 [&_button]:shadow-sm hover:[&_button]:bg-[#7c3aed]',
                }}
              />
            </div>

            <div className="mt-5 flex w-full flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-slate-500">
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-[4px] bg-[#f4ecfd]" />
                Dia com aula experimental
              </span>
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-[4px] bg-[#8b5cf6]" />
                Hoje
              </span>
            </div>
          </div>

          <div className="flex min-h-[380px] flex-1 flex-col bg-slate-50/50 p-6">
            <div className="mb-4">
              <p className="text-sm font-semibold capitalize text-slate-900">
                Aulas de {formatDayLabel(selectedDate)}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {aulasSelecionadas.length === 0
                  ? 'Nenhuma aula experimental neste dia.'
                  : `${aulasSelecionadas.length} aula${aulasSelecionadas.length > 1 ? 's' : ''} experimental${aulasSelecionadas.length > 1 ? 'is' : ''} neste dia.`}
              </p>
            </div>

            <div className="max-h-[228px] space-y-2.5 overflow-y-auto pr-1">
              {aulasSelecionadas.length === 0 ? (
                <div className="flex h-full min-h-[160px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-4 text-center text-sm text-slate-500">
                  Nenhuma aula experimental cadastrada para a data selecionada.
                </div>
              ) : (
                aulasSelecionadas.map((aula) => (
                  <div
                    key={aula.id}
                    className="flex items-center gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#f4ecfd] text-xs font-semibold text-[#4c1d95]">
                      {aula.alunoFoto ? (
                        <img src={aula.alunoFoto} alt={aula.alunoNome} className="h-full w-full object-cover" />
                      ) : (
                        <span>{getInitials(aula.alunoNome)}</span>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium leading-tight text-slate-900">{aula.alunoNome}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {aula.turmaNome} • {formatTimeLabel(aula.startAt)} - {formatTimeLabel(aula.endAt)}
                      </p>
                    </div>

                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${getStatusClassName(aula.status)}`}>
                      {getStatusLabel(aula.status)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}