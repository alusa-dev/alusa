import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listMatriculasRequest,
  type ListMatriculasParams,
  type MatriculaListItem,
  type MatriculaStatus,
  cancelarMatriculaRequest,
} from '../services/matriculas-service';

export interface UseMatriculasOptions {
  contaId: string | null | undefined;
  status?: MatriculaStatus | MatriculaStatus[];
  excludeStatus?: MatriculaStatus | MatriculaStatus[];
  search?: string;
  turmaId?: string;
}

interface UseMatriculasState {
  items: MatriculaListItem[];
  loading: boolean;
  error: string | null;
  total: number;
  page: number;
  pageSize: number;
}

const INITIAL_STATE: UseMatriculasState = {
  items: [],
  loading: false,
  error: null,
  total: 0,
  page: 1,
  pageSize: 6,
};

export function useMatriculas({ contaId, status, excludeStatus, search, turmaId }: UseMatriculasOptions) {
  const [state, setState] = useState<UseMatriculasState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (overrides?: Partial<Omit<ListMatriculasParams, 'contaId'>>) => {
      if (!contaId) {
        console.log('[useMatriculas] contaId ainda não disponível, aguardando...');
        return; // não limpar para manter qualquer estado anterior enquanto aguardamos
      }

      console.log('[useMatriculas] Carregando matrículas:', { contaId, status, excludeStatus, search, turmaId, overrides });

      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const result = await listMatriculasRequest({
          contaId,
          status,
          excludeStatus,
          search,
          turmaId,
          page: overrides?.page ?? 1,
          pageSize: overrides?.pageSize ?? 6,
          signal: controller.signal,
        });

        console.log('[useMatriculas] Matrículas carregadas:', {
          total: result.total,
          items: result.data.length,
          page: result.page,
        });

        setState({
          items: result.data,
          loading: false,
          error: null,
          total: result.total,
          page: result.page,
          pageSize: result.pageSize,
        });
      } catch (error) {
        if ((error as { name?: string }).name === 'AbortError') return;
        setState((prev) => ({
          ...prev,
          loading: false,
          items: [],
          total: 0,
          page: 1,
          error: (error as Error).message,
        }));
      }
    },
    [contaId, status, excludeStatus, search, turmaId],
  );

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  const reload = useCallback(() => {
    console.log('[useMatriculas] Reload solicitado, página atual:', state.page);
    void load({ page: state.page, pageSize: state.pageSize });
  }, [load, state.page, state.pageSize]);

  const setPage = useCallback(
    (page: number) => {
      void load({ page, pageSize: state.pageSize });
    },
    [load, state.pageSize],
  );

  const setPageSize = useCallback(
    (pageSize: number) => {
      void load({ page: 1, pageSize });
    },
    [load],
  );

  const cancel = useCallback(
    async (id: string) => {
      if (!contaId) return;
      await cancelarMatriculaRequest({ id, contaId });
      setState((prev) => ({
        ...prev,
        items: prev.items.filter((item) => item.id !== id),
        total: Math.max(0, prev.total - 1),
      }));
    },
    [contaId],
  );

  return {
    ...state,
    reload,
    cancel,
    setPage,
    setPageSize,
  };
}
