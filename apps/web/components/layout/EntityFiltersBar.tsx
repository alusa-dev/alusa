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
  /** Sobrescreve o título da seção de ordenação no menu (ex.: vencimento em Cobranças). */
  sortMenuTitle?: string;
  /** Rótulo da opção de ordenação crescente / primeiro critério. */
  sortAscLabel?: string;
  /** Rótulo da opção de ordenação decrescente / segundo critério. */
  sortDescLabel?: string;
  className?: string;
  /** Conteúdo após o campo de busca (ex.: selects de tipo / visão em Cobranças). */
  extraLeft?: ReactNode;
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
  sortMenuTitle = 'Ordenar por nome',
  sortAscLabel = 'A–Z (crescente)',
  sortDescLabel = 'Z–A (decrescente)',
  className = '',
  extraLeft,
  extraFilters,
}: EntityFiltersBarProps) {
  return (
    <div
      className={cn(
        'flex w-full flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-end lg:gap-2',
        className,
      )}
    >
      {/* Ordem: busca → extraLeft → status → Filtro; no desktop o bloco alinha à direita da seção. */}
      <div className="relative w-full min-w-0 shrink-0 lg:w-[360px] xl:w-[420px]">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 alusa-dark:text-[color:var(--color-text-muted)]" />
        <Input
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSearchEnter?.();
          }}
          className="h-10 rounded-lg border-slate-200 pl-10 shadow-none alusa-dark:border-[color:var(--color-input-border)] alusa-dark:bg-[color:var(--color-input-bg)] alusa-dark:text-[color:var(--color-input-text)] alusa-dark:placeholder:text-[color:var(--color-input-placeholder)]"
        />
      </div>
      {extraLeft ? <div className="min-w-0 lg:shrink-0">{extraLeft}</div> : null}
      <div
        className={cn(
          'grid min-w-0 gap-2 lg:contents',
          hideStatusFilter ? 'grid-cols-1' : 'grid-cols-2',
        )}
      >
        {hideStatusFilter ? null : (
          <Select value={statusValue} onValueChange={(v: StatusValue) => onStatusChange(v)}>
            <SelectTrigger className="flex h-10 w-full min-w-0 shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded-lg border-slate-200 bg-white px-3 text-slate-700 shadow-none alusa-dark:border-[color:var(--color-input-border)] alusa-dark:bg-[color:var(--color-input-bg)] alusa-dark:text-[color:var(--color-input-text)] lg:w-auto lg:min-w-[150px] lg:max-w-[190px]">
              <SelectValue placeholder="Todos os status" />
            </SelectTrigger>
            <SelectContent align="end" className="text-[13px]">
              <SelectItem value="TODOS">Todos os status</SelectItem>
              <SelectItem value="ATIVO">Ativos</SelectItem>
              <SelectItem value="INATIVO">Inativos</SelectItem>
            </SelectContent>
          </Select>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="h-10 w-full rounded-lg border-slate-200 bg-white px-4 text-slate-700 shadow-none hover:bg-slate-50 alusa-dark:border-[color:var(--color-border-default)] alusa-dark:bg-[color:var(--color-bg-card-soft)] alusa-dark:text-[color:var(--color-text-primary)] alusa-dark:hover:bg-[color:rgba(255,255,255,0.06)] lg:w-auto"
            >
              <Filter className="mr-2 h-4 w-4" /> Filtro
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500 alusa-dark:text-[color:var(--color-text-muted)]">
              {sortMenuTitle}
            </div>
            <DropdownMenuItem
              onClick={() => onSortChange('ASC')}
              className={'justify-between ' + (sortOrder === 'ASC' ? 'text-brand-accent' : '')}
            >
              {sortAscLabel}
              {sortOrder === 'ASC' ? <CheckCircle className="h-4 w-4" /> : null}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onSortChange('DESC')}
              className={'justify-between ' + (sortOrder === 'DESC' ? 'text-brand-accent' : '')}
            >
              {sortDescLabel}
              {sortOrder === 'DESC' ? <CheckCircle className="h-4 w-4" /> : null}
            </DropdownMenuItem>
            {extraFilters && (
              <>
                <div className="my-1 h-px bg-gray-100 alusa-dark:bg-[color:var(--color-border-subtle)]" />
                <div className="px-2 py-1.5">
                  {extraFilters}
                </div>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
