import { useCallback, useEffect, useRef, useState } from 'react';
import type { AlunoListItem } from '../services/alunos-service';
import { deleteAluno, listAlunos } from '../services/alunos-service';

export interface UseAlunosOptions {
  contaId: string | null | undefined;
  q?: string;
  status?: string;
  pageSize?: number;
  sortOrder?: 'ASC' | 'DESC';
}

interface UseAlunosState {
  items: AlunoListItem[];
  total: number;
  loading: boolean;
  error: string | null;
  page: number;
  pageSize: number;
}

const INITIAL_STATE: UseAlunosState = {
  items: [],
  total: 0,
  loading: false,
  error: null,
  page: 1,
  pageSize: 6,
};

export function useAlunos({
  contaId,
  q = '',
  status = 'ATIVO',
  pageSize = 6,
  sortOrder = 'ASC',
}: UseAlunosOptions) {
  const [state, setState] = useState<UseAlunosState>({ ...INITIAL_STATE, pageSize });
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (overrides?: { page?: number; pageSize?: number }) => {
      if (!contaId) {
        setState((prev) => ({ ...prev, items: [], total: 0, loading: false }));
        return;
      }

      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;

      const page = overrides?.page ?? 1;
      const effectivePageSize = overrides?.pageSize ?? pageSize;

      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const data = await listAlunos({
          contaId,
          signal: controller.signal,
          q,
          status,
          page,
          pageSize: effectivePageSize,
          sortOrder,
        });
        setState({
          items: data.items,
          total: data.total,
          loading: false,
          error: null,
          page: data.page ?? page,
          pageSize: data.pageSize ?? effectivePageSize,
        });
      } catch (err) {
        if ((err as { name?: string }).name === 'AbortError') {
          return;
        }
        setState((prev) => ({
          ...prev,
          loading: false,
          items: [],
          total: 0,
          page: 1,
          error: (err as Error).message,
        }));
      }
    },
    [contaId, pageSize, q, sortOrder, status],
  );

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  useEffect(() => {
    if (!contaId) {
      setState((prev) => ({ ...prev, items: [], total: 0, loading: false, page: 1 }));
    }
  }, [contaId]);

  const reload = useCallback(() => {
    void load({ page: state.page, pageSize: state.pageSize });
  }, [load, state.page, state.pageSize]);

  const setPage = useCallback(
    (page: number) => {
      void load({ page, pageSize: state.pageSize });
    },
    [load, state.pageSize],
  );

  const remove = useCallback(async ({ id, reason }: { id: string; reason?: string }) => {
    const result = await deleteAluno({ id, reason });
    await load({ page: state.page, pageSize: state.pageSize });
    return result;
  }, [load, state.page, state.pageSize]);

  return {
    items: state.items,
    total: state.total,
    loading: state.loading,
    error: state.error,
    page: state.page,
    pageSize: state.pageSize,
    reload,
    setPage,
    remove,
  };
}
