'use client';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Filter, Search } from '@/components/icons/icons';
import { NOTA_FISCAL_STATUS_FILTER_OPTIONS } from '@/features/financeiro/notafiscal/dtos';
import { toDateValue, toIsoDate } from '@/features/financeiro/pagamentos/payment-history-utils';
import { cn } from '@/lib/cn';

const datePickerClassName =
  'h-10 rounded-lg border-gray-200 bg-white text-[13px] text-gray-700 shadow-none';

const filterTriggerClassName =
  'h-9 shrink-0 whitespace-nowrap rounded-lg border border-gray-200 bg-white px-3 text-[13px] text-gray-700 shadow-none hover:bg-gray-50';

const selectTriggerClassName =
  'h-10 rounded-lg border border-gray-200 bg-white text-[13px] text-gray-700 shadow-none';

type NotaFiscalStatusFiltersProps = {
  mode?: 'all' | 'search' | 'filters' | 'detail';
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  statusValue: string;
  onStatusChange: (value: string) => void;
  effectiveDateFrom: string;
  onEffectiveDateFromChange: (value: string) => void;
  effectiveDateTo: string;
  onEffectiveDateToChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
};

function countActiveFilters(
  statusValue: string,
  effectiveDateFrom: string,
  effectiveDateTo: string,
): number {
  return [
    statusValue !== 'TODOS',
    Boolean(effectiveDateFrom),
    Boolean(effectiveDateTo),
  ].filter(Boolean).length;
}

function NotaFiscalFiltersPopover({
  statusValue,
  onStatusChange,
  effectiveDateFrom,
  onEffectiveDateFromChange,
  effectiveDateTo,
  onEffectiveDateToChange,
  disabled,
  title = 'Filtros adicionais',
  description = 'Use só quando precisar refinar a listagem de notas fiscais.',
}: Pick<
  NotaFiscalStatusFiltersProps,
  | 'statusValue'
  | 'onStatusChange'
  | 'effectiveDateFrom'
  | 'onEffectiveDateFromChange'
  | 'effectiveDateTo'
  | 'onEffectiveDateToChange'
  | 'disabled'
> & {
  title?: string;
  description?: string;
}) {
  const activeFilters = countActiveFilters(statusValue, effectiveDateFrom, effectiveDateTo);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className={filterTriggerClassName} disabled={disabled}>
          <Filter className="mr-2 h-4 w-4" />
          {activeFilters > 0 ? `Filtros (${activeFilters})` : 'Filtros'}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[320px] rounded-xl border border-gray-200 bg-white p-4 shadow-sm"
      >
        <div className="space-y-4">
          <div>
            <div className="text-sm font-semibold text-gray-900">{title}</div>
            <div className="mt-1 text-xs text-gray-500">{description}</div>
          </div>

          <div className="space-y-3">
            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Status
              </label>
              <Select value={statusValue} onValueChange={onStatusChange} disabled={disabled}>
                <SelectTrigger className={selectTriggerClassName}>
                  <SelectValue placeholder="Status da nota" />
                </SelectTrigger>
                <SelectContent align="end" className="text-[13px]">
                  {NOTA_FISCAL_STATUS_FILTER_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Período de emissão
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-2">
                  <span className="text-xs text-gray-500">Início</span>
                  <DatePicker
                    variant="input"
                    value={toDateValue(effectiveDateFrom)}
                    onChange={(date) => onEffectiveDateFromChange(toIsoDate(date))}
                    placeholder="dd/mm/aaaa"
                    disabled={disabled}
                    maxDate={toDateValue(effectiveDateTo)}
                    className={datePickerClassName}
                    id="nota-fiscal-effective-date-from"
                  />
                </div>
                <div className="space-y-2">
                  <span className="text-xs text-gray-500">Fim</span>
                  <DatePicker
                    variant="input"
                    value={toDateValue(effectiveDateTo)}
                    onChange={(date) => onEffectiveDateToChange(toIsoDate(date))}
                    placeholder="dd/mm/aaaa"
                    disabled={disabled}
                    minDate={toDateValue(effectiveDateFrom)}
                    className={datePickerClassName}
                    id="nota-fiscal-effective-date-to"
                  />
                </div>
              </div>
            </div>
          </div>

          {activeFilters > 0 ? (
            <Button
              type="button"
              variant="ghost"
              className="h-8 px-2 text-xs text-gray-500 hover:text-gray-900"
              disabled={disabled}
              onClick={() => {
                onStatusChange('TODOS');
                onEffectiveDateFromChange('');
                onEffectiveDateToChange('');
              }}
            >
              Limpar filtros
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function NotaFiscalStatusFilters({
  mode = 'all',
  searchValue = '',
  onSearchChange,
  statusValue,
  onStatusChange,
  effectiveDateFrom,
  onEffectiveDateFromChange,
  effectiveDateTo,
  onEffectiveDateToChange,
  disabled = false,
  className,
}: NotaFiscalStatusFiltersProps) {
  const filterPopoverProps = {
    statusValue,
    onStatusChange,
    effectiveDateFrom,
    onEffectiveDateFromChange,
    effectiveDateTo,
    onEffectiveDateToChange,
    disabled,
  };

  if (mode === 'search') {
    return (
      <div className={cn('relative w-full lg:max-w-[420px]', className)}>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          value={searchValue}
          onChange={(event) => onSearchChange?.(event.target.value)}
          placeholder="Buscar cliente por nome"
          className="h-10 rounded-lg border border-gray-200 bg-white pl-10 text-[13px] text-gray-700 shadow-none"
          disabled={disabled}
        />
      </div>
    );
  }

  if (mode === 'filters' || mode === 'detail') {
    return (
      <div className={cn('flex shrink-0 justify-end', className)}>
        <NotaFiscalFiltersPopover {...filterPopoverProps} />
      </div>
    );
  }

  return (
    <div className={cn('flex w-full flex-col gap-4 lg:flex-row lg:items-center lg:justify-between', className)}>
      <div className="relative w-full lg:max-w-[420px]">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input
          value={searchValue}
          onChange={(event) => onSearchChange?.(event.target.value)}
          placeholder="Buscar cliente por nome"
          className="h-10 rounded-lg border border-gray-200 bg-white pl-10 text-[13px] text-gray-700 shadow-none"
          disabled={disabled}
        />
      </div>
      <div className="flex shrink-0 justify-end lg:w-auto">
        <NotaFiscalFiltersPopover {...filterPopoverProps} />
      </div>
    </div>
  );
}
