import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deletePlanoRequest,
  listPlans,
  type ListPlansParams,
  type PlanListItem,
} from '../services/plans-service';

export interface UsePlansOptions {
  contaId: string | null | undefined;
}

export interface UsePlansFilters {
  search?: string;
  status?: ListPlansParams['status'];
}

export function usePlans({ contaId }: UsePlansOptions) {
  const [items, setItems] = useState<PlanListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const filtersRef = useRef<UsePlansFilters>({});

  const load = useCallback(
    async (filters?: UsePlansFilters) => {
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
        const data = await listPlans({
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
    async (filters?: UsePlansFilters) => {
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

export type UsePlansReturn = ReturnType<typeof usePlans>;
