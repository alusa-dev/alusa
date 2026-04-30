'use client';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Search, Filter, CheckCircle } from '@/components/icons/icons';
import { cn } from '@/lib/cn';

export type StatusValue = 'TODOS' | 'ATIVO' | 'INATIVO';
export type SortOrder = 'ASC' | 'DESC';

interface EntityFiltersBarProps {
  searchValue: string;
  onSearchChange: (_v: string) => void;
  onSearchEnter?: () => void;
  searchPlaceholder?: string;
  statusValue: StatusValue;
  onStatusChange: (_v: StatusValue) => void;
  hideStatusFilter?: boolean;
  sortOrder: SortOrder;
  onSortChange: (_o: SortOrder) => void;
  className?: string;
  extraLeft?: ReactNode; // espaço para futuros filtros específicos
  extraFilters?: ReactNode; // espaço para filtros adicionais no dropdown
}

export default function EntityFiltersBar({
  searchValue,
  onSearchChange,
  onSearchEnter,
  searchPlaceholder = 'Buscar...',
  statusValue,
  onStatusChange,
  hideStatusFilter = false,
  sortOrder,
  onSortChange,
  className = '',
  extraLeft,
  extraFilters,
}: EntityFiltersBarProps) {
  return (
    <div className={cn('flex w-full flex-col gap-3 lg:flex-row lg:items-center lg:justify-between', className)}>
      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
        {extraLeft}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="h-10 rounded-lg border-slate-200 bg-white px-4 text-slate-700 shadow-none hover:bg-slate-50"
            >
              <Filter className="h-4 w-4 mr-2" /> Filtro
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">
              Ordenar por nome
            </div>
            <DropdownMenuItem
              onClick={() => onSortChange('ASC')}
              className={'justify-between ' + (sortOrder === 'ASC' ? 'text-brand-accent' : '')}
            >
              A–Z (crescente)
              {sortOrder === 'ASC' ? <CheckCircle className="h-4 w-4" /> : null}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onSortChange('DESC')}
              className={'justify-between ' + (sortOrder === 'DESC' ? 'text-brand-accent' : '')}
            >
              Z–A (decrescente)
              {sortOrder === 'DESC' ? <CheckCircle className="h-4 w-4" /> : null}
            </DropdownMenuItem>
            {extraFilters && (
              <>
                <div className="my-1 h-px bg-gray-100" />
                <div className="px-2 py-1.5">
                  {extraFilters}
                </div>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        {hideStatusFilter ? null : (
          <Select value={statusValue} onValueChange={(v: StatusValue) => onStatusChange(v)}>
            <SelectTrigger className="flex h-10 w-full shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded-lg border-slate-200 bg-white px-3 text-slate-700 shadow-none md:w-auto md:min-w-[150px] md:max-w-[190px]">
              <SelectValue placeholder="Todos os status" />
            </SelectTrigger>
            <SelectContent align="end" className="text-[13px]">
              <SelectItem value="TODOS">Todos os status</SelectItem>
              <SelectItem value="ATIVO">Ativos</SelectItem>
              <SelectItem value="INATIVO">Inativos</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
      <div className="relative w-full lg:ml-auto lg:flex-1 lg:max-w-[360px] xl:max-w-[420px]">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSearchEnter?.();
          }}
          className="h-10 rounded-lg border-slate-200 pl-10 shadow-none"
        />
      </div>
    </div>
  );
}
