import { useCallback, useEffect, useState } from 'react';
import { listCombos, type ComboListItem, type ComboStatus } from '../services/combos-service';

interface UseCombosParams {
  contaId: string | null;
  status?: ComboStatus;
  search?: string;
}

export function useCombos({ contaId, status, search }: UseCombosParams) {
  const [items, setItems] = useState<ComboListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    async (override?: { status?: ComboStatus; search?: string }) => {
      if (!contaId) {
        setItems([]);
        return;
      }
      try {
        setLoading(true);
        const data = await listCombos({
          contaId,
          status: override?.status ?? status,
          search: override?.search ?? search,
        });
        setItems(data);
        setError(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [contaId, status, search],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  return { items, loading, error, reload, setItems };
}

export type UseCombosReturn = ReturnType<typeof useCombos>;
