'use client';

import type { ExtratoResponse } from '../dtos';
import { ExtratoFiltersBar } from './ExtratoFiltersBar';
import { ExtratoTable } from './ExtratoTable';
import { ExtratoTablePagination } from './ExtratoTablePagination';
import type { LedgerEntry } from '../dtos';
import type { ExtratoFiltersState } from '../hooks/useExtratoFilters';
import { formatPeriodLabel } from '../utils/extrato-formatters';

interface ExtratoTableSectionProps {
  data: ExtratoResponse | null;
  filters: ExtratoFiltersState;
  loading?: boolean;
  error?: string | null;
  onFiltersChange: (patch: Partial<ExtratoFiltersState>) => void;
  onFiltersClear: () => void;
  onPageChange: (page: number) => void;
  onSelectEntry: (entry: LedgerEntry) => void;
}

export function ExtratoTableSection({
  data,
  filters,
  loading,
  error,
  onFiltersChange,
  onFiltersClear,
  onPageChange,
  onSelectEntry,
}: ExtratoTableSectionProps) {
  const totalItems = data?.pagination?.totalItems ?? 0;
  const periodLabel = formatPeriodLabel(filters.startDate || undefined, filters.endDate || undefined);

  return (
    <div className="flex flex-col overflow-visible rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-col gap-4 border-b border-slate-100 bg-gray-50 px-4 py-4 rounded-t-xl md:px-5">
        <div>
          <div>
            <p className="text-sm font-semibold text-slate-900">Movimentações do período</p>
            <p className="mt-1 text-xs text-slate-500">
              {totalItems} resultado(s) visíveis • {periodLabel}
            </p>
          </div>
        </div>
        <ExtratoFiltersBar
          filters={filters}
          onChange={onFiltersChange}
          onClear={onFiltersClear}
        />
      </div>

      {error && (
        <div className="border-b border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {error}
        </div>
      )}

      {data?.sync?.truncated && (
        <div className="border-b border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          O extrato excedeu a janela segura de leitura do Asaas para este período. A tela mostra
          as primeiras {data.sync.fetchedCount} movimentações de {data.sync.officialTotalCount}{' '}
          retornadas pelo ledger oficial. Refine o período para evitar leitura parcial.
        </div>
      )}

      <div className="overflow-hidden rounded-b-xl">
        <ExtratoTable
          entries={data?.transactions ?? []}
          loading={loading}
          hasActiveFilters={Boolean(
            filters.search || filters.startDate || filters.endDate || filters.type.length || filters.status.length,
          )}
          onSelect={onSelectEntry}
        />

        {data?.pagination && (
          <ExtratoTablePagination
            pagination={data.pagination}
            onPageChange={onPageChange}
          />
        )}
      </div>
    </div>
  );
}
