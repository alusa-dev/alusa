'use client';

import { useState } from 'react';
import type { LedgerEntry } from './dtos';
import { useExtratoFilters } from './hooks/useExtratoFilters';
import { useExtratoQuery } from './hooks/useExtratoQuery';
import { ExtratoHeader } from './components/ExtratoHeader';
import { ExtratoSummaryCards } from './components/ExtratoSummaryCards';
import { ExtratoTableSection } from './components/ExtratoTableSection';
import { ExtratoDetailsDrawer } from './components/ExtratoDetailsDrawer';
import { AsaasSeal } from '@/components/shared/AsaasSeal';

const EMPTY_SUMMARY = { receitas: 0, despesas: 0, estornos: 0, liquido: 0 };

export function ExtratoPage() {
  const { filters, setFilters, clearFilters } = useExtratoFilters();
  const { data, loading, error } = useExtratoQuery(filters);
  const [selectedEntry, setSelectedEntry] = useState<LedgerEntry | null>(null);

  return (
    <div className="w-full min-w-0 space-y-5">
      <ExtratoHeader
        filters={filters}
      />

      <ExtratoSummaryCards
        summary={data?.summary ?? EMPTY_SUMMARY}
        loading={loading}
      />

      <ExtratoTableSection
        data={data}
        filters={filters}
        loading={loading}
        error={error}
        onFiltersChange={setFilters}
        onFiltersClear={clearFilters}
        onPageChange={(page) => setFilters({ page })}
        onSelectEntry={setSelectedEntry}
      />

      {selectedEntry && (
        <ExtratoDetailsDrawer
          entry={selectedEntry}
          onClose={() => setSelectedEntry(null)}
        />
      )}

      <div className="flex justify-center pt-1 pb-2">
        <AsaasSeal variant="negativo-preto" />
      </div>
    </div>
  );
}
