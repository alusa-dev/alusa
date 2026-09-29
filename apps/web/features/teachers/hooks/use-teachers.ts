import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteTeacher,
  listTeachers,
  type TeacherListItem,
  type ListTeachersParams,
} from '../services/teachers-service';

export interface UseTeachersOptions {
  contaId: string | null | undefined;
}

export interface UseTeachersFilters {
  search?: string;
  status?: 'ATIVO' | 'INATIVO' | 'TODOS';
}

export function useTeachers({ contaId }: UseTeachersOptions) {
  const [items, setItems] = useState<TeacherListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (filters?: UseTeachersFilters) => {
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
        const params: ListTeachersParams = {
          contaId,
          signal: controller.signal,
          search: filters?.search,
          status: filters?.status,
        };
        const data = await listTeachers(params);
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
      await deleteTeacher({ id, contaId: targetContaId });
      setItems((prev) => prev.filter((professor) => professor.id !== id));
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

export type UseTeachersReturn = ReturnType<typeof useTeachers>;
