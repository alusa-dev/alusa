import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listRematriculasElegiveisRequest,
  type ListRematriculasParams,
  type RematriculaElegivelItem,
  type StatusContrato,
} from '../services/rematriculas-service';

export interface UseRematriculasOptions {
  contaId: string | null | undefined;
  diasAntecedencia?: number;
  statusContrato?: StatusContrato;
  referencia?: string;
  search?: string;
}

interface UseRematriculasState {
  items: RematriculaElegivelItem[];
  loading: boolean;
  error: string | null;
  total: number;
  referencia: string | null;
  ate: string | null;
}

const INITIAL_STATE: UseRematriculasState = {
  items: [],
  loading: false,
  error: null,
  total: 0,
  referencia: null,
  ate: null,
};

export function useRematriculas(options: UseRematriculasOptions) {
  const { contaId, diasAntecedencia, statusContrato, referencia, search } = options;
  const [state, setState] = useState<UseRematriculasState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (overrides?: Partial<Omit<ListRematriculasParams, 'contaId'>>) => {
      if (!contaId) {
        return;
      }

      if (abortRef.current) {
        abortRef.current.abort();
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setState((prev) => ({ ...prev, loading: true, error: null }));

      try {
        const result = await listRematriculasElegiveisRequest({
          contaId,
          diasAntecedencia,
          statusContrato,
          referencia,
          search,
          signal: controller.signal,
          ...overrides,
        });

        setState({
          items: result.itens,
          loading: false,
          error: null,
          total: result.total,
          referencia: result.referencia,
          ate: result.ate,
        });
      } catch (error) {
        if ((error as { name?: string }).name === 'AbortError') return;
        setState({
          items: [],
          loading: false,
          error: (error as Error).message,
          total: 0,
          referencia: null,
          ate: null,
        });
      }
    },
    [contaId, diasAntecedencia, statusContrato, referencia, search],
  );

  useEffect(() => {
    void load();
    return () => {
      abortRef.current?.abort();
    };
  }, [load]);

  const reload = useCallback(() => {
    void load();
  }, [load]);

  return {
    ...state,
    reload,
  };
}
