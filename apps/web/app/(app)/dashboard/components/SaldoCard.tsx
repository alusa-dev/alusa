"use client";

import { useState, useEffect, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import useCurrentUser from '@/hooks/use-current-user';
import { formatCurrency } from './utils';

interface SaldoData {
  saldoDisponivel: number;
  fonte: string;
  consultadoEm: string;
}

function useSaldoAsaas() {
  const { user } = useCurrentUser();
  const [data, setData] = useState<SaldoData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSaldo = useCallback(async () => {
    if (!user?.contaId) return;

    setLoading(true);
    // Não limpa o erro anterior imediatamente para evitar flicker se for revalidação
    // Mas como é first load na maioria das vezes, ok.

    try {
      const response = await fetch('/api/financeiro/saldo');
      const result = await response.json();

      if (result.data) {
        setData(result.data);
        setError(null);
      } else if (result.error) {
        setError(result.error.message);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [user?.contaId]);

  useEffect(() => {
    fetchSaldo();
    // Refresh automatico a cada 60s
    const interval = setInterval(fetchSaldo, 60000);
    return () => clearInterval(interval);
  }, [fetchSaldo]);

  return { data, loading, error };
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

