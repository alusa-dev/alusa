'use client';

import { useEffect, useState } from 'react';

import type { ListMakeupClassesQueryDTO } from '@/features/aulas/dtos';
import { listMakeupClasses } from '@/features/aulas/reposicoes/services/makeup-service';

export type MakeupFiltersState = {
  turmaId?: string;
  alunoId?: string;
  status?: string[];
  startDate?: string;
  endDate?: string;
};

export function useMakeupClasses(initial?: MakeupFiltersState) {
  const [filters, setFilters] = useState<MakeupFiltersState>(initial ?? {});
  const [data, setData] = useState<Awaited<ReturnType<typeof listMakeupClasses>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const requestKey = JSON.stringify(filters);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        setLoading(true);
        setError(null);
        const result = await listMakeupClasses(filters as Partial<ListMakeupClassesQueryDTO>);
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [requestKey, filters]);

  return {
    filters,
    setFilters,
    data,
    loading,
    error,
  };
}
