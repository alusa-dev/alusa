'use client';

import { useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { controlClass, labelClass } from '@/lib/finance-form-utils';
import type { FinancePayerCandidateDTO } from '@/features/finance/dtos';

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
}

export function PayerSearchInput({
  search,
  label = 'Cliente',
  placeholder = 'Selecione o cliente',
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
    const base = selectedPayer.name;
    if (selectedPayer.payerResolved.type === 'responsavel' && selectedPayer.type === 'aluno') {
      return `${base} · Responsável financeiro: ${selectedPayer.payerResolved.name}`;
    }
    return base;
  }, [selectedPayer, searchQuery]);

  return (
    <div className="relative">
      <label className={labelClass}>{label}</label>
      <Input
        className={controlClass}
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
            <ul className="max-h-56 overflow-auto">
              {searchResults.map((item) => (
                <li
                  key={item.id}
                  className="cursor-pointer px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelectPayer(item)}
                >
                  <div className="font-medium text-gray-900">{item.name}</div>
                  <div className="text-xs text-gray-500">
                    {item.type === 'aluno' ? 'Aluno' : 'Responsável financeiro'}
                    {item.payerResolved.type === 'responsavel' && item.type === 'aluno'
                      ? ` · Pagador: ${item.payerResolved.name}`
                      : ''}
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
