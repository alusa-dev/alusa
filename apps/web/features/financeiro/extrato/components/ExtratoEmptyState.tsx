'use client';

interface ExtratoEmptyStateProps {
  hasActiveFilters?: boolean;
}

export function ExtratoEmptyState({ hasActiveFilters }: ExtratoEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gray-100">
        <svg className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      <h3 className="mb-1 text-sm font-medium text-gray-900">
        {hasActiveFilters ? 'Nenhum resultado para este recorte' : 'Nenhuma movimentação disponível'}
      </h3>
      <p className="max-w-sm text-xs text-gray-500">
        {hasActiveFilters
          ? 'A conta possui ledger oficial, mas nenhum item corresponde aos filtros aplicados. Ajuste o período ou limpe o recorte.'
          : 'A subconta ainda não retornou movimentações que impactem o saldo oficial no período atual.'}
      </p>
    </div>
  );
}
