import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '@/components/ui/toast';
import {
  listAlunosComContratos,
  type AlunoContratoCard,
  type ContratoStatus,
} from '../services/contratos-service';

export type ContratosAlunoStatusFilter = 'TODOS' | ContratoStatus;

export interface UseContratosAlunosFilters {
  search: string;
  status: ContratosAlunoStatusFilter;
  turmaId: string;
}

export function useContratosAlunos(filters: UseContratosAlunosFilters) {
  const [alunos, setAlunos] = useState<AlunoContratoCard[]>([]);
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
        },
        controller.signal,
      );
      setAlunos(data);
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      const message = (err as Error).message;
      setError(message);
      toast.error(message);
      setAlunos([]);
    } finally {
      setLoading(false);
    }
  }, [filters.search, filters.status, filters.turmaId]);

  useEffect(() => {
    const t = setTimeout(() => {
      void load();
    }, 250);

    return () => {
      clearTimeout(t);
      abortRef.current?.abort();
    };
  }, [load]);

  return { alunos, loading, error, reload: load };
}
