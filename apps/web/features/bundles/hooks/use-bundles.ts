import { useCallback, useEffect, useState } from 'react';
import { listBundles, type BundleListItem, type BundleStatus } from '../services/bundles-service';

interface UseBundlesParams {
  contaId: string | null;
  status?: BundleStatus;
  search?: string;
}

export function useBundles({ contaId, status, search }: UseBundlesParams) {
  const [items, setItems] = useState<BundleListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(
    async (override?: { status?: BundleStatus; search?: string }) => {
      if (!contaId) {
        setItems([]);
        return;
      }
      try {
        setLoading(true);
        const data = await listBundles({
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

export type UseBundlesReturn = ReturnType<typeof useBundles>;
