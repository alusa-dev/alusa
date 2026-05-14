'use client';

import { useMemo, useState } from 'react';
import { getDefaultClassNames } from 'react-day-picker';
import { Calendar } from '@/components/ui/calendar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { DashboardAniversarianteDTO } from '@/features/dashboard/dtos';
import { cn } from '@/lib/cn';
import { DASHBOARD_SECTION_CARD_CLASSNAME } from './utils';

const RDP_DEFAULT_CLASS_NAMES = getDefaultClassNames();

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

type AniversariantesMesCardProps = {
  aniversariantes: DashboardAniversarianteDTO[];
};

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'AL';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getMonthLabel(date: Date) {
  return MONTH_NAMES[date.getMonth()];
}

function getBirthdayLabel(
  dataNascimento: string | null | undefined,
  dia: number,
  mes: number,
  viewYear: number,
): string {
  if (!dataNascimento) return '? anos';
  const birthYear = new Date(dataNascimento).getFullYear();
  if (isNaN(birthYear)) return '? anos';
  const age = viewYear - birthYear;

  const today = new Date();
  const todayY = today.getFullYear();
  const todayM = today.getMonth() + 1;
  const todayD = today.getDate();

  if (mes < todayM || (mes === todayM && dia < todayD)) return `Completou ${age} anos`;
  if (mes === todayM && dia === todayD) return `Completando ${age} anos`;
  // birthday is this year but hasn't happened yet — use next occurrence year if needed
  return `Irá completar ${viewYear === todayY ? age : age} anos`;
}

function getBirthdaysForMonth(aniversariantes: DashboardAniversarianteDTO[], monthDate: Date) {
  return aniversariantes
    .filter((aniversariante) => aniversariante.mes === monthDate.getMonth() + 1)
    .sort((first, second) => {
      if (first.dia !== second.dia) return first.dia - second.dia;
      return first.nome.localeCompare(second.nome, 'pt-BR');
    });
}

function getBirthdayDates(aniversariantes: DashboardAniversarianteDTO[], monthDate: Date) {
  return aniversariantes.map(
    (aniversariante) =>
      new Date(monthDate.getFullYear(), monthDate.getMonth(), aniversariante.dia, 12, 0, 0, 0),
  );
}

export function AniversariantesMesCard({ aniversariantes }: AniversariantesMesCardProps) {
  const todayMonth = useMemo(() => startOfMonth(new Date()), []);
  const [viewMonth, setViewMonth] = useState(todayMonth);

  const currentMonthBirthdays = useMemo(
    () => getBirthdaysForMonth(aniversariantes, todayMonth),
    [aniversariantes, todayMonth],
  );
  const viewedBirthdays = useMemo(
    () => getBirthdaysForMonth(aniversariantes, viewMonth),
    [aniversariantes, viewMonth],
  );
  const birthdayDates = useMemo(
    () => getBirthdayDates(viewedBirthdays, viewMonth),
    [viewedBirthdays, viewMonth],
  );

  const visibleStudents = currentMonthBirthdays.slice(0, 3);
  const remainingCount = Math.max(0, currentMonthBirthdays.length - visibleStudents.length);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className={`${DASHBOARD_SECTION_CARD_CLASSNAME} flex h-full w-full flex-col justify-between rounded-2xl bg-white px-5 py-4 text-left transition-colors hover:bg-gray-50/60 focus:ring-0 focus:ring-offset-0 focus-visible:ring-2 focus-visible:ring-brand-accent/35 focus-visible:ring-offset-0 alusa-dark:bg-[color:var(--color-bg-card)] alusa-dark:hover:bg-white/[0.04]`}
        >
          <div>
            <p className="text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">Aniversários do mês</p>
            <p className="mt-1 text-xs capitalize text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">{getMonthLabel(todayMonth)}</p>
          </div>

          <div className="mt-4 flex-1 space-y-2.5">
            {visibleStudents.length === 0 ? (
              <p className="text-sm leading-6 text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">Nenhum aniversariante ativo neste mês.</p>
            ) : (
              visibleStudents.map((student) => (
                <div key={student.id} className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#f4ecfd] text-[11px] font-semibold text-[#383242] alusa-dark:bg-[color:var(--color-bg-card-soft)] alusa-dark:text-[color:var(--color-text-primary)]">
                    {student.foto ? (
                      <img src={student.foto} alt={student.nome} className="h-full w-full object-cover" />
                    ) : (
                      <span>{getInitials(student.nome)}</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">{student.nome}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-[#f4ecfd] px-2 py-0.5 text-[11px] font-medium text-[#383242] alusa-dark:bg-[color:rgba(169,77,255,0.16)] alusa-dark:text-[color:#c9a7ff]">
                    {getBirthdayLabel(student.dataNascimento, student.dia, student.mes, todayMonth.getFullYear())}
                  </span>
                </div>
              ))
            )}
          </div>

          <div className="mt-4 flex items-center justify-between text-xs text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">
            <span>{remainingCount > 0 ? `+${remainingCount} para ver` : 'Clique para abrir'}</span>
            <span className="font-medium text-[#383242] alusa-dark:text-[color:var(--color-brand-300)]">Ver calendário</span>
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
        <DialogHeader className="relative border-b border-gray-100 px-6 py-5 text-left max-md:shrink-0 max-md:space-y-0 max-md:px-4 max-md:py-4 max-md:pb-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))] md:px-6 md:py-5 alusa-dark:border-[color:rgba(148,146,209,0.14)]">
          <span className="pointer-events-none absolute inset-x-0 top-0 hidden h-px bg-gradient-to-r from-transparent via-brand-accent/40 to-transparent max-md:block" />
          <div>
            <DialogTitle className="pr-2 text-base font-semibold text-slate-900 md:pr-0 alusa-dark:text-[color:var(--color-text-primary)]">
              Aniversariantes
            </DialogTitle>
            <DialogDescription className="mt-1 text-left text-sm text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
              Navegue entre os meses pelo calendário para ver aniversários passados e futuros.
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="max-md:flex max-md:min-h-0 max-md:flex-1 max-md:flex-col max-md:overflow-hidden md:block md:overflow-visible">
          <div className="max-md:min-h-0 max-md:flex-1 max-md:overflow-y-auto md:overflow-visible">
              <div className="flex flex-col sm:flex-row">
              <div className="flex flex-col items-center border-b border-gray-100 p-6 max-md:w-full max-md:min-w-0 max-md:items-center max-md:px-5 max-md:py-4 sm:w-[340px] sm:shrink-0 sm:border-b-0 sm:border-r sm:p-6 alusa-dark:border-[color:rgba(148,146,209,0.14)]">
                <div className="w-fit max-md:w-full max-md:max-w-[21rem] max-md:min-w-0">
                  <Calendar
                    mode="single"
                    month={viewMonth}
                    onMonthChange={(date) => setViewMonth(startOfMonth(date))}
                    selected={undefined}
                    showOutsideDays
                    modifiers={{ birthday: birthdayDates }}
                    modifiersClassNames={{
                      birthday: 'alusa-calendar-event-day',
                    }}
                    className="bg-transparent p-0 [--cell-size:2.1rem] max-md:w-full max-md:min-w-0 max-md:[--cell-size:2.25rem]"
                    classNames={{
                      root: cn(RDP_DEFAULT_CLASS_NAMES.root, 'max-md:w-full max-md:min-w-0 md:w-fit'),
                      month_grid: cn(
                        RDP_DEFAULT_CLASS_NAMES.month_grid,
                        'w-full border-collapse max-md:table-fixed',
                      ),
                      weekdays: cn(RDP_DEFAULT_CLASS_NAMES.weekdays, 'flex w-full max-md:!table-row max-md:h-8'),
                      week: cn(RDP_DEFAULT_CLASS_NAMES.week, 'mt-2 flex w-full max-md:!table-row max-md:!mt-0'),
                      caption_label:
                        'text-sm font-semibold tracking-tight text-slate-900 capitalize alusa-dark:text-[color:var(--color-text-primary)]',
                      weekday:
                        'select-none text-[13px] font-medium text-slate-400 capitalize text-center max-md:!table-cell max-md:text-[11px] md:w-[--cell-size] md:flex-none alusa-dark:text-[color:rgba(237,239,255,0.45)]',
                      day: cn(
                        RDP_DEFAULT_CLASS_NAMES.day,
                        'group/day relative aspect-square h-full w-full select-none p-0 text-center max-md:!table-cell max-md:h-[--cell-size] max-md:w-[--cell-size] max-md:align-middle max-md:[&_button]:mx-auto max-md:[&_button]:h-8 max-md:[&_button]:w-8 max-md:[&_button]:text-[11px] [&:first-child[data-selected=true]_button]:rounded-l-md [&:last-child[data-selected=true]_button]:rounded-r-md',
                      ),
                      today: 'alusa-calendar-today-day',
                    }}
                  />
                </div>

                <div className="mt-5 flex w-full flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-slate-500 max-md:mt-4 max-md:gap-x-4 max-md:text-[11px] alusa-dark:text-[color:var(--color-text-secondary)]">
                  <span className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-[#f4ecfd] alusa-dark:bg-[color:rgba(201,167,255,0.45)]" />
                    Dia com aniversariante
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-[#6b21a8]" />
                    Hoje
                  </span>
                </div>
              </div>

              <div className="flex min-h-0 flex-1 flex-col bg-slate-50/50 p-6 max-md:min-h-0 sm:min-h-[380px] alusa-dark:bg-[color:rgba(21,22,30,0.55)]">
                <div className="mb-4">
                  <p className="text-sm font-semibold text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">
                    Aniversariantes de {getMonthLabel(viewMonth).toLowerCase()}
                  </p>
                  <p className="mt-1 text-sm text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
                    {viewedBirthdays.length === 0
                      ? 'Nenhum aniversariante neste mês.'
                      : `${viewedBirthdays.length} aniversariante${viewedBirthdays.length > 1 ? 's' : ''} neste mês.`}
                  </p>
                </div>

                <div className="max-h-[228px] space-y-2.5 overflow-y-auto pr-1 max-md:max-h-none max-md:flex-1 max-md:overflow-visible max-md:pr-0 sm:max-h-[228px] sm:flex-none sm:overflow-y-auto">
                  {viewedBirthdays.length === 0 ? (
                    <div className="alusa-dialog-empty-slot flex h-full min-h-[160px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white px-4 text-center text-sm text-slate-500 alusa-dark:border-[color:rgba(148,146,209,0.22)] alusa-dark:bg-[color:rgba(21,22,30,0.5)] alusa-dark:text-[color:var(--color-text-secondary)]">
                      Nenhum aniversariante cadastrado.
                    </div>
                  ) : (
                    viewedBirthdays.map((student) => (
                      <div
                        key={student.id}
                        className="alusa-dialog-list-row-slot flex items-center gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] max-md:flex-col max-md:items-stretch max-md:gap-2 alusa-dark:border-[color:rgba(148,146,209,0.14)] alusa-dark:bg-[color:var(--color-bg-card-soft)] alusa-dark:shadow-none"
                      >
                        <div className="flex min-w-0 flex-1 items-start gap-3 md:items-center">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#f4ecfd] text-xs font-semibold text-[#4c1d95] alusa-dark:bg-[color:rgba(169,77,255,0.16)] alusa-dark:text-[color:#c9a7ff]">
                            {student.foto ? (
                              <img src={student.foto} alt={student.nome} className="h-full w-full object-cover" />
                            ) : (
                              <span>{getInitials(student.nome)}</span>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium leading-tight text-slate-900 alusa-dark:text-[color:var(--color-text-primary)]">{student.nome}</p>
                            <p className="mt-0.5 text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">
                              Aniversário em {String(student.dia).padStart(2, '0')}/{String(student.mes).padStart(2, '0')}
                            </p>
                          </div>
                        </div>

                        <span className="inline-flex w-fit shrink-0 rounded-full bg-[#f4ecfd] px-2.5 py-1 text-xs font-medium text-[#4c1d95] max-md:self-start max-md:ml-[calc(2.5rem+0.75rem)] alusa-dark:bg-[color:rgba(169,77,255,0.16)] alusa-dark:text-[color:#c9a7ff]">
                          {getBirthdayLabel(student.dataNascimento, student.dia, student.mes, viewMonth.getFullYear())}
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
