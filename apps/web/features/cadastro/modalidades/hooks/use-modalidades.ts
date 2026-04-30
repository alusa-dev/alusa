import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteModalidade,
  listModalidades,
  type ListModalidadesParams,
  type ModalidadeListItem,
} from '../services/modalidades-service';

export interface UseModalidadesOptions {
  contaId: string | null | undefined;
}

export interface UseModalidadesFilters {
  search?: string;
  status?: ListModalidadesParams['status'];
}

export function useModalidades({ contaId }: UseModalidadesOptions) {
  const [items, setItems] = useState<ModalidadeListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (filters?: UseModalidadesFilters) => {
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
        const data = await listModalidades({
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
      await deleteModalidade({ id, contaId: targetContaId });
      setItems((prev) => prev.filter((m) => m.id !== id));
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

export type UseModalidadesReturn = ReturnType<typeof useModalidades>;
