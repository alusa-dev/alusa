'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AutocompleteOption } from '@/components/matriculas/wizard/shared/AutocompleteList';

type StudentSearchItem = {
  id: string;
  nome: string;
  cpf?: string | null;
  email?: string | null;
};

type SelectedStudent = { id: string; nome: string };

export function useStudentAutocomplete({ enabled }: { enabled: boolean }) {
  const [studentQuery, setStudentQuery] = useState('');
  const [studentResults, setStudentResults] = useState<AutocompleteOption[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<SelectedStudent | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(0);

  const resetAutocomplete = useCallback(() => {
    setStudentQuery('');
    setStudentResults([]);
    setSearchLoading(false);
    setShowSuggestions(false);
    setSelectedStudent(null);
    setHighlightedIndex(0);
  }, []);

  const changeStudentQuery = useCallback((value: string) => {
    setStudentQuery(value);
    setShowSuggestions(true);
    setSelectedStudent((current) => (current && value !== current.nome ? null : current));
  }, []);

  const selectStudent = useCallback((option: AutocompleteOption) => {
    setSelectedStudent({ id: option.value, nome: option.label });
    setStudentQuery(option.label);
    setShowSuggestions(false);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const term = studentQuery.trim();
    if (term.length < 2 || (selectedStudent && term === selectedStudent.nome)) {
      setStudentResults([]);
      setSearchLoading(false);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const res = await fetch('/api/alunos?q=' + encodeURIComponent(term), { signal: controller.signal });
        const json = (await res.json()) as { items?: StudentSearchItem[] };
        const items = json?.items ?? [];
        setStudentResults(items.map((item) => ({
          value: item.id,
          label: item.nome,
          description: item.cpf || item.email || undefined,
        })));
        setHighlightedIndex(0);
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          console.error(err);
        }
      } finally {
        setSearchLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [enabled, studentQuery, selectedStudent]);

  return {
    studentQuery,
    studentResults,
    searchLoading,
    showSuggestions,
    selectedStudent,
    highlightedIndex,
    setHighlightedIndex,
    setShowSuggestions,
    changeStudentQuery,
    selectStudent,
    resetAutocomplete,
  };
}
