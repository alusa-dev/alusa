import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteClass,
  listClasses,
  type ListClassesParams,
  type ClassListItem,
} from '../services/classes-service';

export interface UseClassesOptions {
  contaId: string | null | undefined;
}

export interface UseClassesFilters {
  search?: string;
  status?: ListClassesParams['status'];
}

export function useClasses({ contaId }: UseClassesOptions) {
  const [items, setItems] = useState<ClassListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (filters?: UseClassesFilters) => {
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
        const data = await listClasses({
          contaId,
          search: filters?.search,
          status: filters?.status,
          signal: controller.signal,
        });
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
      await deleteClass({ id, contaId: targetContaId });
      setItems((prev) => prev.filter((turma) => turma.id !== id));
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

export type UseClassesReturn = ReturnType<typeof useClasses>;
