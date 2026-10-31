'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FinancePayerCandidateDTO } from '@/features/finance/dtos';

interface UsePayerSearchReturn {
  searchQuery: string;
  setSearchQuery: (_q: string) => void;
  searchResults: FinancePayerCandidateDTO[];
  searching: boolean;
  searchError: boolean;
  searchOpen: boolean;
  setSearchOpen: (_open: boolean) => void;
  selectedPayer: FinancePayerCandidateDTO | null;
  handleSelectPayer: (_payer: FinancePayerCandidateDTO) => void;
  clearSelection: () => void;
  reset: () => void;
}

export function usePayerSearch(options: { context?: 'sales' } = {}): UsePayerSearchReturn {
  const [searchQuery, setSearchQueryState] = useState('');
  const [searchResults, setSearchResults] = useState<FinancePayerCandidateDTO[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [selectedPayer, setSelectedPayer] = useState<FinancePayerCandidateDTO | null>(null);
  const searchDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const [searchError, setSearchError] = useState(false);

  const setSearchQuery = useCallback((query: string) => {
    requestRef.current?.abort();
    generationRef.current += 1;
    setSearchQueryState(query);
    setSearchResults([]);
    setSearching(false);
    setSearchError(false);
  }, []);

  const fetchPayers = useCallback(async (query: string) => {
    const generation = ++generationRef.current;
    requestRef.current?.abort();
    setSearchResults([]);
    setSearchError(false);
    if (query.trim().length < 2) {
      setSearching(false);
      return;
    }

    const controller = new AbortController();
    requestRef.current = controller;
    setSearching(true);
    try {
      const context = options.context === 'sales' ? '&context=sales' : '';
      const res = await fetch(`/api/finance/payers/search?q=${encodeURIComponent(query.trim())}${context}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!res.ok) throw new Error('Erro ao buscar pagadores');
      const data = await res.json();
      const items = Array.isArray(data?.results) ? data.results : [];
      if (generation === generationRef.current) setSearchResults(items);
    } catch {
      if (generation === generationRef.current) setSearchError(true);
    } finally {
      if (generation === generationRef.current) setSearching(false);
    }
  }, [options.context]);

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    requestRef.current?.abort();
    generationRef.current += 1;
    setSearchResults([]);
    setSearching(false);
    setSearchError(false);
    if (!searchOpen || selectedPayer) return;
    if (searchQuery.trim().length < 2) return;
    setSearching(true);
    searchDebounceRef.current = setTimeout(() => {
      void fetchPayers(searchQuery);
    }, 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      requestRef.current?.abort();
      generationRef.current += 1;
    };
  }, [fetchPayers, searchOpen, searchQuery, selectedPayer]);

  const handleSelectPayer = useCallback((payer: FinancePayerCandidateDTO) => {
    requestRef.current?.abort();
    generationRef.current += 1;
    setSelectedPayer(payer);
    setSearchResults([]);
    setSearchQuery(payer.name);
    setSearchOpen(false);
  }, [setSearchQuery]);

  const clearSelection = useCallback(() => {
    setSelectedPayer(null);
  }, []);

  const reset = useCallback(() => {
    requestRef.current?.abort();
    generationRef.current += 1;
    setSelectedPayer(null);
    setSearchQueryState('');
    setSearchResults([]);
    setSearchOpen(false);
  }, []);

  return {
    searchQuery,
    setSearchQuery,
    searchResults,
    searching,
    searchOpen,
    searchError,
    setSearchOpen,
    selectedPayer,
    handleSelectPayer,
    clearSelection,
    reset,
  };
}
