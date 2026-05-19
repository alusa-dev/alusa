import { useCallback, useEffect, useRef, useState } from 'react';
import type { AlunoListItem } from '../services/alunos-service';
import { deleteAluno, listAlunos } from '../services/alunos-service';

export interface UseAlunosOptions {
  contaId: string | null | undefined;
  q?: string;
  status?: string;
  page?: number;
  pageSize?: number;
  sortOrder?: 'ASC' | 'DESC';
}

export function useAlunos({
  contaId,
  q = '',
  status = 'TODOS',
  page = 1,
  pageSize = 6,
  sortOrder = 'ASC',
}: UseAlunosOptions) {
  const [items, setItems] = useState<AlunoListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!contaId) {
      setItems([]);
      setTotal(0);
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
      const data = await listAlunos({
        contaId,
        signal: controller.signal,
        q,
        status,
        page,
        pageSize,
        sortOrder,
      });
      setItems(data.items);
      setTotal(data.total);
    } catch (err) {
      if ((err as { name?: string }).name === 'AbortError') {
        return;
      }
      setItems([]);
      setTotal(0);
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [contaId, page, pageSize, q, sortOrder, status]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  useEffect(() => {
    if (!contaId) {
      setItems([]);
      setTotal(0);
      setLoading(false);
    }
  }, [contaId]);

  const remove = useCallback(async ({ id, reason }: { id: string; reason?: string }) => {
    await deleteAluno({ id, reason });
    setItems((prev) => prev.filter((aluno) => aluno.id !== id));
    setTotal((prev) => Math.max(0, prev - 1));
  }, []);

  return {
    items,
    total,
    loading,
    error,
    reload: load,
    remove,
  };
}
