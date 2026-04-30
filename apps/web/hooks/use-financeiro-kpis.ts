import { useState, useEffect, useCallback } from 'react';
import useCurrentUser from '@/hooks/use-current-user';
import type { FinanceiroKpisResultDTO, FinanceiroKpiDataDTO } from '@/features/financeiro/dtos';

export type KpiData = FinanceiroKpiDataDTO;
export type KpisResponse = FinanceiroKpisResultDTO['data'];

export function useFinanceiroKpis() {
  const { user } = useCurrentUser();
  const [data, setData] = useState<KpisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchKpis = useCallback(async () => {
    if (!user?.contaId) return;
    
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/financeiro/kpis');
      const result = await response.json();
      
      const payload = result as Partial<FinanceiroKpisResultDTO>;
      if (payload.data) {
        setData(payload.data);
      } else if ((result as { error?: { message?: string } }).error) {
        setError((result as { error?: { message?: string } }).error?.message ?? 'Erro ao carregar KPIs');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [user?.contaId]);

  useEffect(() => {
    fetchKpis();
  }, [fetchKpis]);

  return { data, loading, error, refetch: fetchKpis };
}
