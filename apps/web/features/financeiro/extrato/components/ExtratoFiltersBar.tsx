'use client';

import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Filter, Search } from '@/components/icons/icons';
import type { ExtratoFiltersState } from '../hooks/useExtratoFilters';
import type { LedgerEntryStatus, LedgerEntryType } from '../dtos';

const ALL_TYPES = '__ALL_TYPES__';
const ALL_STATUS = '__ALL_STATUS__';

interface ExtratoFiltersBarProps {
  filters: ExtratoFiltersState;
  onChange: (_patch: Partial<ExtratoFiltersState>) => void;
  onClear: () => void;
}

export function ExtratoFiltersBar({ filters, onChange, onClear }: ExtratoFiltersBarProps) {
  const activeCount = [
    Boolean(filters.startDate),
    Boolean(filters.endDate),
    filters.type.length > 0,
    filters.status.length > 0,
    Boolean(filters.search.trim()),
  ].filter(Boolean).length;

  return (
    <div className="flex w-full flex-col gap-3">
      {/* busca + ordenação + filtros avançados */}
      <div className="rounded-xl border border-slate-200 bg-gray-50 p-3">
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
          <div className="relative w-full max-w-xl">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              type="text"
              placeholder="Buscar por descrição, cliente, payment ID..."
              value={filters.search}
              onChange={(e) => onChange({ search: e.target.value, page: 1 })}
              className="h-10 rounded-lg border-slate-200 bg-white pl-9 shadow-sm"
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row xl:justify-end">
            <Select
              value={filters.direction}
              onValueChange={(value) => onChange({ direction: value as 'asc' | 'desc', page: 1 })}
            >
              <SelectTrigger className="h-10 w-full min-w-[170px] rounded-lg border-slate-200 bg-white shadow-sm sm:w-[170px]">
                <SelectValue placeholder="Ordem" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desc">Mais recente</SelectItem>
                <SelectItem value="asc">Mais antigo</SelectItem>
              </SelectContent>
            </Select>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="relative h-10 rounded-lg border-slate-200 bg-white px-4 shadow-sm">
                  <Filter className="mr-2 h-4 w-4" />
                  Filtros avançados
                  {activeCount > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-xs text-white">
                      {activeCount}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-80 rounded-xl border-slate-200 p-4 shadow-[0_8px_30px_rgba(15,23,42,0.12)]"
                align="end"
                sideOffset={10}
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-slate-900">Refinar extrato</h4>
                    {activeCount > 0 && (
                      <button
                        type="button"
                        onClick={onClear}
                        className="text-xs font-medium text-slate-600 hover:text-slate-900"
                      >
                        Limpar tudo
                      </button>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-gray-500">Data inicial</label>
                      <Input
                        type="date"
                        value={filters.startDate}
                        onChange={(e) => onChange({ startDate: e.target.value, page: 1 })}
                        className="h-9 rounded-xl border-slate-200 bg-white"
                        max={filters.endDate || undefined}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-gray-500">Data final</label>
                      <Input
                        type="date"
                        value={filters.endDate}
                        onChange={(e) => onChange({ endDate: e.target.value, page: 1 })}
                        className="h-9 rounded-xl border-slate-200 bg-white"
                        min={filters.startDate || undefined}
                      />
                    </div>

                    <div className="space-y-1.5 border-t border-slate-100 pt-3">
                      <label className="text-xs font-medium text-gray-500">Tipo</label>
                      <Select
                        value={filters.type[0] ?? ALL_TYPES}
                        onValueChange={(value) =>
                          onChange({
                            type: value === ALL_TYPES ? [] : [value as LedgerEntryType],
                            page: 1,
                          })
                        }
                      >
                        <SelectTrigger className="h-9 w-full rounded-xl border-slate-200 bg-white">
                          <SelectValue placeholder="Todos os tipos" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ALL_TYPES}>Todos</SelectItem>
                          <SelectItem value="RECEITA">Receita</SelectItem>
                          <SelectItem value="TAXA">Taxa</SelectItem>
                          <SelectItem value="ESTORNO">Estorno</SelectItem>
                          <SelectItem value="TRANSFERENCIA">Transferência</SelectItem>
                          <SelectItem value="ANTECIPACAO">Antecipação</SelectItem>
                          <SelectItem value="AJUSTE">Ajuste</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-gray-500">Status</label>
                      <Select
                        value={filters.status[0] ?? ALL_STATUS}
                        onValueChange={(value) =>
                          onChange({
                            status: value === ALL_STATUS ? [] : [value as LedgerEntryStatus],
                            page: 1,
                          })
                        }
                      >
                        <SelectTrigger className="h-9 w-full rounded-xl border-slate-200 bg-white">
                          <SelectValue placeholder="Todos os status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ALL_STATUS}>Todos</SelectItem>
                          <SelectItem value="CONFIRMADO">Confirmado</SelectItem>
                          <SelectItem value="CANCELADO">Cancelado</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </div>
    </div>
  );
}
