import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteProfessor,
  listProfessores,
  type ProfessorListItem,
  type ListProfessoresParams,
} from '../services/professores-service';

export interface UseProfessoresOptions {
  contaId: string | null | undefined;
}

export interface UseProfessoresFilters {
  search?: string;
  status?: 'ATIVO' | 'INATIVO' | 'TODOS';
}

export function useProfessores({ contaId }: UseProfessoresOptions) {
  const [items, setItems] = useState<ProfessorListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (filters?: UseProfessoresFilters) => {
      if (!contaId) {
        setItems([]);
        return;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);
      try {
        const params: ListProfessoresParams = {
          contaId,
          signal: controller.signal,
          search: filters?.search,
          status: filters?.status,
        };
        const data = await listProfessores(params);
        setItems(data);
      } catch (err) {
        if ((err as { name?: string }).name !== 'AbortError') {
          setItems([]);
          setError((err as Error).message);
        }
      } finally {
        setLoading(false);
      }
    },
    [contaId],
  );

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const remove = useCallback(
    async ({ id, contaId: contaIdOverride }: { id: string; contaId: string }) => {
      const targetContaId = contaIdOverride ?? (typeof contaId === 'string' ? contaId : undefined);
      if (!targetContaId) throw new Error('Conta não informada para exclusão.');
      await deleteProfessor({ id, contaId: targetContaId });
      setItems((prev) => prev.filter((professor) => professor.id !== id));
    },
    [contaId],
  );

  return {
    items,
    loading,
    error,
    reload: load,
    remove,
    setItems,
  };
}

export type UseProfessoresReturn = ReturnType<typeof useProfessores>;
