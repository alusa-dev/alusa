'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FinancePayerCandidateDTO } from '@/features/finance/dtos';

interface UsePayerSearchReturn {
  searchQuery: string;
  setSearchQuery: (_q: string) => void;
  searchResults: FinancePayerCandidateDTO[];
  searching: boolean;
  searchOpen: boolean;
  setSearchOpen: (_open: boolean) => void;
  selectedPayer: FinancePayerCandidateDTO | null;
  handleSelectPayer: (_payer: FinancePayerCandidateDTO) => void;
  clearSelection: () => void;
  reset: () => void;
}

export function usePayerSearch(): UsePayerSearchReturn {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<FinancePayerCandidateDTO[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedPayer, setSelectedPayer] = useState<FinancePayerCandidateDTO | null>(null);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);

  const fetchPayers = useCallback(async (query: string) => {
    if (query.trim().length < 2) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    try {
      const res = await fetch(`/api/finance/payers/search?q=${encodeURIComponent(query.trim())}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error('Erro ao buscar pagadores');
      const data = await res.json();
      const items = Array.isArray(data?.results) ? data.results : [];
      setSearchResults(items);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!searchOpen || selectedPayer) return;
    searchDebounceRef.current = setTimeout(() => {
      void fetchPayers(searchQuery);
    }, 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [fetchPayers, searchOpen, searchQuery, selectedPayer]);

  const handleSelectPayer = useCallback((payer: FinancePayerCandidateDTO) => {
    setSelectedPayer(payer);
    setSearchQuery(payer.name);
    setSearchOpen(false);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedPayer(null);
  }, []);

  const reset = useCallback(() => {
    setSelectedPayer(null);
    setSearchQuery('');
    setSearchResults([]);
    setSearchOpen(false);
  }, []);

  return {
    searchQuery,
    setSearchQuery,
    searchResults,
    searching,
    searchOpen,
    setSearchOpen,
    selectedPayer,
    handleSelectPayer,
    clearSelection,
    reset,
  };
}
