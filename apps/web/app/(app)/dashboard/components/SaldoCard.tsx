"use client";

import { useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import useCurrentUser from '@/hooks/use-current-user';
import { useFinanceListLoad } from '@/features/financeiro/hooks/use-finance-list-load';
import { formatCurrency } from './utils';

interface SaldoData {
  saldoDisponivel: number;
  fonte: string;
  consultadoEm: string;
}

function useSaldoAsaas() {
  const { user } = useCurrentUser();
  const [data, setData] = useState<SaldoData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { isInitialLoading } = useFinanceListLoad(
    async ({ signal }) => {
      if (!user?.contaId) return;
      const response = await fetch('/api/financeiro/saldo', { signal });
      const result = await response.json();

      if (result.data) {
        setData(result.data);
        setError(null);
      } else if (result.error) {
        setError(result.error.message);
      }
    },
    {
      deps: [user?.contaId],
      liveRefreshEnabled: Boolean(user?.contaId),
      intervalMs: 60_000,
      minIntervalMs: 10_000,
    },
  );

  return { data, loading: isInitialLoading, error };
}

export function SaldoCard() {
  const { data, loading, error } = useSaldoAsaas();

  if (loading && !data) {
    return (
      <div className="flex flex-col justify-between rounded-2xl bg-[#f4ecfd] px-5 py-4 min-h-[220px] h-full animate-pulse">
        <div>
          <Skeleton className="h-4 w-28 bg-[#e9dffc] mb-2" />
          <Skeleton className="h-10 w-36 bg-[#e9dffc]" />
        </div>
      </div>
    );
  }

  const saldo = data?.saldoDisponivel ?? 0;

  return (
    <div className="flex flex-col justify-between rounded-2xl bg-[#f4ecfd] px-5 py-4 min-h-[220px] h-full">
      <div>
        <p className="text-[13px] font-normal tracking-wide text-[#2b2634] mb-2">
          Saldo Disponível
        </p>
        <span className="text-4xl leading-none font-medium text-[#2b2634] mb-1 block">
          {error ? '---' : formatCurrency(saldo)}
        </span>
      </div>
    </div>
  );
}

