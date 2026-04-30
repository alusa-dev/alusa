import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteSala,
  listSalas,
  type ListSalasParams,
  type SalaListItem,
} from '../services/salas-service';

export interface UseSalasOptions {
  contaId: string | null | undefined;
}

export interface UseSalasFilters {
  search?: string;
  status?: ListSalasParams['status'];
}

export function useSalas({ contaId }: UseSalasOptions) {
  const [items, setItems] = useState<SalaListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (filters?: UseSalasFilters) => {
      if (!contaId) {
        setItems([]);
        setLoading(false);
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);

      try {
        const data = await listSalas({
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

  useEffect(() => {
    if (!contaId) {
      setItems([]);
      setLoading(false);
    }
  }, [contaId]);

  const remove = useCallback(
    async ({ id, contaId: contaIdOverride }: { id: string; contaId?: string }) => {
      const targetContaId = contaIdOverride ?? (typeof contaId === 'string' ? contaId : undefined);
      if (!targetContaId) throw new Error('Conta não informada para exclusão.');
      await deleteSala({ id, contaId: targetContaId });
      setItems((prev) => prev.filter((sala) => sala.id !== id));
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

export type UseSalasReturn = ReturnType<typeof useSalas>;
