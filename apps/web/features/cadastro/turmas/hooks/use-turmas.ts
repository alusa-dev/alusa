import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteTurma,
  listTurmas,
  type ListTurmasParams,
  type TurmaListItem,
} from '../services/turmas-service';

export interface UseTurmasOptions {
  contaId: string | null | undefined;
}

export interface UseTurmasFilters {
  search?: string;
  status?: ListTurmasParams['status'];
}

export function useTurmas({ contaId }: UseTurmasOptions) {
  const [items, setItems] = useState<TurmaListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (filters?: UseTurmasFilters) => {
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
        const data = await listTurmas({
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
      await deleteTurma({ id, contaId: targetContaId });
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

export type UseTurmasReturn = ReturnType<typeof useTurmas>;
