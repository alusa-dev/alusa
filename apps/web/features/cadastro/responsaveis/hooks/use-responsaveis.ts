import { useCallback, useEffect, useRef, useState } from 'react';

import { listResponsaveis, type ResponsavelListItem } from '../services/responsaveis-service';

export function useResponsaveis({
  enabled = true,
  query,
}: {
  enabled?: boolean;
  query?: string;
} = {}) {
  const [items, setItems] = useState<ResponsavelListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!enabled) {
      setItems([]);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);

    try {
      const data = await listResponsaveis({ signal: controller.signal, query });
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
  }, [enabled, query]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  useEffect(() => {
    if (!enabled) {
      setItems([]);
      setLoading(false);
    }
  }, [enabled]);

  return {
    items,
    loading,
    error,
    reload: load,
  };
}
