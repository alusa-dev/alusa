import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/components/ui/toast';
import {
  listAlunosComContratos,
  type AlunoContratoCard,
  type ContratoStatus,
  type AlunosComContratosPage,
} from '../services/contratos-service';

export type ContratosAlunoStatusFilter = 'TODOS' | ContratoStatus;

export interface UseContratosAlunosFilters {
  search: string;
  status: ContratosAlunoStatusFilter;
  turmaId: string;
}

export function useContratosAlunos(filters: UseContratosAlunosFilters & { page: number }) {
  const [alunos, setAlunos] = useState<AlunoContratoCard[]>([]);
  const [pagination, setPagination] = useState<AlunosComContratosPage['pagination']>({
    page: 1,
    pageSize: 7,
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPreviousPage: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);

    try {
      const data = await listAlunosComContratos(
        {
          q: filters.search,
          status: filters.status === 'TODOS' ? undefined : filters.status,
          turmaId: filters.turmaId || undefined,
          page: filters.page,
        },
        controller.signal,
      );
      setAlunos(data.data);
      setPagination(data.pagination);
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      const message = (err as Error).message;
      setError(message);
      toast.error(message);
      setAlunos([]);
      setPagination((current) => ({ ...current, page: filters.page }));
    } finally {
      setLoading(false);
    }
  }, [filters.page, filters.search, filters.status, filters.turmaId]);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 250);

    return () => {
      clearTimeout(t);
      abortRef.current?.abort();
    };
  }, [load]);

  return { alunos, loading, error, pagination, reload: load };
}
