'use client';

import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { controlClass, labelClass } from '@/lib/finance-form-utils';
import type { FinancePayerCandidateDTO } from '@/features/finance/dtos';
import { maskCPF } from '@/lib/utils/masks';

export type PayerSearchResult = FinancePayerCandidateDTO;

export type PayerSearchState = {
  searchQuery: string;
  setSearchQuery: (_q: string) => void;
  searchResults: FinancePayerCandidateDTO[];
  searching: boolean;
  searchOpen: boolean;
  setSearchOpen: (_open: boolean) => void;
  selectedPayer: FinancePayerCandidateDTO | null;
  handleSelectPayer: (_payer: FinancePayerCandidateDTO) => void;
  clearSelection: () => void;
};

interface PayerSearchInputProps {
  search: PayerSearchState;
  label?: string;
  placeholder?: string;
  salesDisplay?: boolean;
}

export function PayerSearchInput({
  search,
  label = 'Cliente',
  placeholder = 'Selecione o cliente',
  salesDisplay = false,
}: PayerSearchInputProps) {
  const {
    searchQuery,
    setSearchQuery,
    searchResults,
    searching,
    searchOpen,
    setSearchOpen,
    selectedPayer,
    handleSelectPayer,
    clearSelection,
  } = search;

  const displayValue = useMemo(() => {
    if (!selectedPayer) return searchQuery;
    const base = salesDisplay ? selectedPayer.salesDisplayName ?? selectedPayer.name : selectedPayer.name;
    if (!salesDisplay && selectedPayer.payerResolved.type === 'responsavel' && selectedPayer.type === 'aluno') {
      return `${base} · Responsável financeiro: ${selectedPayer.payerResolved.name}`;
    }
    return base;
  }, [selectedPayer, searchQuery, salesDisplay]);

  return (
    <div className="relative">
      <label className={labelClass}>{label}</label>
      <Input
        className={
          salesDisplay
            ? 'flex h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-none transition-colors focus-visible:border-[#A94DFF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A94DFF]/30 focus-visible:ring-offset-0'
            : controlClass
        }
        value={displayValue}
        onChange={(e) => {
          clearSelection();
          setSearchQuery(e.target.value);
          setSearchOpen(true);
        }}
        onFocus={() => setSearchOpen(true)}
        onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
        placeholder={placeholder}
      />

      {searchOpen && !selectedPayer && (
        <div className="absolute z-20 mt-2 w-full rounded-md border bg-white shadow-lg">
          {searching ? (
            <div className="px-3 py-2 text-xs text-gray-500">Buscando...</div>
          ) : searchResults.length === 0 ? (
            <div className="px-3 py-2 text-xs text-gray-500">Nenhum resultado</div>
          ) : (
            <ul className="max-h-56 divide-y divide-gray-100 overflow-auto">
              {searchResults.map((item) => (
                <li
                  key={item.id}
                  className="cursor-pointer px-3 py-3 text-sm text-gray-700 hover:bg-gray-50"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelectPayer(item)}
                >
                  {salesDisplay ? (
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 break-words font-medium text-gray-900">
                        {item.salesDisplayName ?? item.name}
                      </div>
                      {item.type === 'aluno' || (item.salesStudentCount ?? 0) > 0 ? (
                        <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          {item.type === 'aluno' || (item.salesStudentCount ?? 0) === 1 ? 'Aluno' : 'Alunos'}
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <div className="font-medium text-gray-900">{item.name}</div>
                  )}
                  <div className="text-xs text-gray-500">
                    {salesDisplay ? (
                      item.type === 'aluno'
                        ? (item.payerResolved.type === 'responsavel' && item.responsibleName ? `Responsável financeiro: ${item.responsibleName}` : '')
                        : `Responsável financeiro: ${item.name}`
                    ) : <>{item.cpf ? `CPF: ${maskCPF(item.cpf)} · ` : ''}{item.type === 'aluno' ? 'Aluno' : 'Responsável financeiro'}{item.payerResolved.type === 'responsavel' && item.type === 'aluno' ? ` · Pagador: ${item.payerResolved.name}` : ''}</>}
                    {item.financialStatus === 'INCOMPLETE' ? ' · Cadastro financeiro pendente' : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
