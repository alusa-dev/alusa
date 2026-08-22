import { useEffect, useRef, useState } from 'react';
import {
  getRematriculaCampaignOverviewRequest,
  type RematriculaCampaignOverview,
} from '../services/rematriculas-service';

export function useRematriculaCampaignOverview(campaignId: string | null, refreshKey = 0) {
  const [data, setData] = useState<RematriculaCampaignOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (!campaignId) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const currentRequestId = ++requestId.current;
    setLoading(true);
    setError(null);

    void getRematriculaCampaignOverviewRequest(campaignId, controller.signal)
      .then((result) => {
        if (currentRequestId !== requestId.current) return;
        setData(result);
      })
      .catch((cause) => {
        if (controller.signal.aborted || currentRequestId !== requestId.current) return;
        setData(null);
        setError(cause instanceof Error ? cause.message : 'Não foi possível carregar as turmas.');
      })
      .finally(() => {
        if (currentRequestId === requestId.current) setLoading(false);
      });

    return () => controller.abort();
  }, [campaignId, refreshKey]);

  return { data, loading, error };
}
