'use client';

import { useState } from 'react';

import { Calendar, ChevronDown } from '@/components/icons/icons';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { ReportFiltersState } from '../hooks/useReportFilters';
import { dateFromIsoDay, isoDay } from '../utils/formatters';

type Props = {
  filters: ReportFiltersState;
  onChange: (_patch: Partial<ReportFiltersState>) => void;
};

function periodValue(filters: ReportFiltersState) {
  const now = new Date();
  const thisStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const thisEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  if (filters.startDate === isoDay(thisStart) && filters.endDate === isoDay(thisEnd)) return 'current';
  const previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const previousEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  if (filters.startDate === isoDay(previousStart) && filters.endDate === isoDay(previousEnd)) return 'previous';
  const quarterStart = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  if (filters.startDate === isoDay(quarterStart) && filters.endDate === isoDay(thisEnd)) return 'quarter';
  return 'custom';
}

function periodLabel(filters: ReportFiltersState) {
  const preset = periodValue(filters);
  if (preset === 'current') return 'Este mês';
  if (preset === 'previous') return 'Mês anterior';
  if (preset === 'quarter') return 'Últimos 3 meses';
  const start = dateFromIsoDay(filters.startDate)?.toLocaleDateString('pt-BR') ?? filters.startDate;
  const end = dateFromIsoDay(filters.endDate)?.toLocaleDateString('pt-BR') ?? filters.endDate;
  return `${start} – ${end}`;
}

export function ReportsFiltersBar({ filters, onChange }: Props) {
  const [periodOpen, setPeriodOpen] = useState(false);

  function choosePeriod(value: string) {
    const now = new Date();
    if (value === 'current') {
      onChange({
        startDate: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)),
        endDate: isoDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      });
    } else if (value === 'previous') {
      onChange({
        startDate: isoDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        endDate: isoDay(new Date(now.getFullYear(), now.getMonth(), 0)),
      });
    } else if (value === 'quarter') {
      onChange({
        startDate: isoDay(new Date(now.getFullYear(), now.getMonth() - 2, 1)),
        endDate: isoDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      });
    }
    setPeriodOpen(false);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover open={periodOpen} onOpenChange={setPeriodOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="h-10 min-w-[178px] justify-between gap-3 bg-white font-normal alusa-dark:bg-[color:var(--color-bg-card-soft)]"
            aria-label="Selecionar período"
          >
            <span className="inline-flex min-w-0 items-center gap-2">
              <Calendar className="h-4 w-4 shrink-0 text-gray-500" />
              <span className="truncate">{periodLabel(filters)}</span>
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(92vw,390px)] p-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">Período da análise</h3>
            <p className="mt-1 text-xs text-gray-500 alusa-dark:text-[color:var(--color-text-secondary)]">Escolha um atalho ou defina datas personalizadas.</p>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <PeriodShortcut active={periodValue(filters) === 'current'} onClick={() => choosePeriod('current')}>Este mês</PeriodShortcut>
            <PeriodShortcut active={periodValue(filters) === 'previous'} onClick={() => choosePeriod('previous')}>Anterior</PeriodShortcut>
            <PeriodShortcut active={periodValue(filters) === 'quarter'} onClick={() => choosePeriod('quarter')}>3 meses</PeriodShortcut>
          </div>
          <div className="my-4 border-t border-slate-200 alusa-dark:border-[color:var(--color-border-default)]" />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">Data inicial</span>
              <DatePicker
                value={dateFromIsoDay(filters.startDate)}
                onChange={(date) => onChange({ startDate: isoDay(date) })}
                maxDate={dateFromIsoDay(filters.endDate)}
                placeholder="Data inicial"
                className="h-10 w-full bg-white alusa-dark:bg-[color:var(--color-bg-card-soft)]"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">Data final</span>
              <DatePicker
                value={dateFromIsoDay(filters.endDate)}
                onChange={(date) => onChange({ endDate: isoDay(date) })}
                minDate={dateFromIsoDay(filters.startDate)}
                placeholder="Data final"
                className="h-10 w-full bg-white alusa-dark:bg-[color:var(--color-bg-card-soft)]"
              />
            </label>
          </div>
        </PopoverContent>
      </Popover>

      <Select
        value={filters.dateBasis}
        onValueChange={(value) => onChange({ dateBasis: value as ReportFiltersState['dateBasis'] })}
      >
        <SelectTrigger className="h-10 w-[168px] bg-white alusa-dark:bg-[color:var(--color-bg-card-soft)]" aria-label="Critério de data">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="DUE_DATE">Por vencimento</SelectItem>
          <SelectItem value="PAID_AT">Por pagamento</SelectItem>
          <SelectItem value="SETTLED_AT">Por liquidação</SelectItem>
          <SelectItem value="COMPETENCE">Por competência</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

function PeriodShortcut({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button type="button" variant={active ? 'default' : 'outline'} size="sm" onClick={onClick} className="h-9 px-2 text-xs">
      {children}
    </Button>
  );
}
