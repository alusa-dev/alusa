import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deletePlanoRequest,
  listPlanos,
  type ListPlanosParams,
  type PlanoListItem,
} from '../services/planos-service';

export interface UsePlanosOptions {
  contaId: string | null | undefined;
}

export interface UsePlanosFilters {
  search?: string;
  status?: ListPlanosParams['status'];
}

export function usePlanos({ contaId }: UsePlanosOptions) {
  const [items, setItems] = useState<PlanoListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const filtersRef = useRef<UsePlanosFilters>({});

  const load = useCallback(
    async (filters?: UsePlanosFilters) => {
      if (!contaId) {
        setItems([]);
        return;
      }

      const nextFilters = filters ?? filtersRef.current ?? {};
      filtersRef.current = nextFilters;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setError(null);

      try {
        const data = await listPlanos({
          contaId,
          search: nextFilters.search,
          status: nextFilters.status,
          signal: controller.signal,
        });
        setItems(data);
      } catch (err) {
        if ((err as { name?: string }).name !== 'AbortError') {
          setError((err as Error).message);
          setItems([]);
        }
      } finally {
        setLoading(false);
      }
    },
    [contaId],
  );

  useEffect(() => {
    void load();
    return () => {
      abortRef.current?.abort();
    };
  }, [load]);

  const reload = useCallback(
    async (filters?: UsePlanosFilters) => {
      const merged = filters ?? filtersRef.current ?? {};
      await load(merged);
    },
    [load],
  );

  const remove = useCallback(
    async ({ id, contaId: contaIdOverride }: { id: string; contaId?: string }) => {
      const targetContaId = contaIdOverride ?? (typeof contaId === 'string' ? contaId : undefined);
      if (!targetContaId) {
        throw new Error('Conta não informada para excluir plano.');
      }
      // Exclusão remota
      await deletePlanoRequest({ id, contaId: targetContaId });
      // Remoção otimista local (sem recarregar para evitar reaparecer se backend só marcar status)
      setItems((prev) => prev.filter((p) => p.id !== id));
    },
    [contaId],
  );

  return {
    items,
    loading,
    error,
    reload,
    remove,
    setItems, // expõe caso seja necessário ajuste manual futuramente
  };
}

export type UsePlanosReturn = ReturnType<typeof usePlanos>;
