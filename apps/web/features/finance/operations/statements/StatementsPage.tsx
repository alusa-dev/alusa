'use client';

import { useState } from 'react';
import type { LedgerEntry } from './dtos';
import { useStatementFilters } from './hooks/useStatementFilters';
import { useStatementQuery } from './hooks/useStatementQuery';
import { StatementHeader } from './components/StatementHeader';
import { StatementSummaryCards } from './components/StatementSummaryCards';
import { StatementTableSection } from './components/StatementTableSection';
import { StatementDetailsDrawer } from './components/StatementDetailsDrawer';
import { AsaasSeal } from '@/components/shared/AsaasSeal';

const EMPTY_SUMMARY = { receitas: 0, despesas: 0, estornos: 0, liquido: 0 };

export function StatementsPage() {
  const { filters, setFilters, clearFilters } = useStatementFilters();
  const { data, loading, error } = useStatementQuery(filters);
  const [selectedEntry, setSelectedEntry] = useState<LedgerEntry | null>(null);

  return (
    <div className="w-full min-w-0 space-y-5">
      <StatementHeader
        filters={filters}
      />

      <StatementSummaryCards
        summary={data?.summary ?? EMPTY_SUMMARY}
        loading={loading}
      />

      <StatementTableSection
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
        <StatementDetailsDrawer
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
