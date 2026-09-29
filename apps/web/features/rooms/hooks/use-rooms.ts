import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteRoom,
  listRooms,
  type ListRoomsParams,
  type RoomListItem,
} from '../services/rooms-service';

export interface UseRoomsOptions {
  contaId: string | null | undefined;
}

export interface UseRoomsFilters {
  search?: string;
  status?: ListRoomsParams['status'];
}

export function useRooms({ contaId }: UseRoomsOptions) {
  const [items, setItems] = useState<RoomListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (filters?: UseRoomsFilters) => {
      if (!contaId) {
        setItems([]);
        setLoading(false);
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);

      try {
        const data = await listRooms({
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

  useEffect(() => {
    if (!contaId) {
      setItems([]);
      setLoading(false);
    }
  }, [contaId]);

  const remove = useCallback(
    async ({ id, contaId: contaIdOverride }: { id: string; contaId?: string }) => {
      const targetContaId = contaIdOverride ?? (typeof contaId === 'string' ? contaId : undefined);
      if (!targetContaId) throw new Error('Conta não informada para exclusão.');
      await deleteRoom({ id, contaId: targetContaId });
      setItems((prev) => prev.filter((sala) => sala.id !== id));
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

export type UseRoomsReturn = ReturnType<typeof useRooms>;
