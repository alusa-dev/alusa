import { useCallback, useEffect, useRef, useState } from 'react';
import type { AlunoListItem } from '../services/alunos-service';
import { deleteAluno, listAlunos } from '../services/alunos-service';

export interface UseAlunosOptions {
  contaId: string | null | undefined;
}

export function useAlunos({ contaId }: UseAlunosOptions) {
  const [items, setItems] = useState<AlunoListItem[]>([]);
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
      const data = await listAlunos({ contaId, signal: controller.signal });
      setItems(data);
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        return;
      }
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
    await deleteAluno({ id, reason });
    setItems((prev) => prev.filter((aluno) => aluno.id !== id));
  }, []);

  return {
    items,
    loading,
    error,
    reload: load,
    remove,
  };
}
