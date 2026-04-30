import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteColaborador,
  listColaboradores,
  type ColaboradorListItem,
} from '../services/colaboradores-service';

export interface UseColaboradoresOptions {
  contaId: string | null | undefined;
}

export function useColaboradores({ contaId }: UseColaboradoresOptions) {
  const [items, setItems] = useState<ColaboradorListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!contaId) {
      setItems([]);
      return;
    }
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const data = await listColaboradores({ contaId, signal: controller.signal });
      setItems(data);
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') return;
      setItems([]);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [contaId]);

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

  const remove = useCallback(async ({ id, reason }: { id: string; reason?: string }) => {
    await deleteColaborador({ id, reason });
    setItems((prev) => prev.filter((colaborador) => colaborador.id !== id));
  }, []);

  return {
    items,
    loading,
    error,
    reload: load,
    remove,
  };
}
