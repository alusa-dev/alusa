'use client';
import { useEffect, useState } from 'react';
import type { FinanceiroIndicadoresResultDTO } from '@/features/financeiro/dtos';

export function FinanceSummary() {
  const [data, setData] = useState<FinanceiroIndicadoresResultDTO['data'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch('/api/financeiro/indicadores', { cache: 'no-store' });
        if (!res.ok) throw new Error(`Erro ${res.status}`);
        const json: FinanceiroIndicadoresResultDTO = await res.json();
        if (!cancelled) setData(json.data);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading)
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-xs text-gray-500">
        Carregando indicadores...
      </div>
    );
  if (error) return <div className="p-3 border rounded text-sm text-red-600">Erro: {error}</div>;
  if (!data) return null;

  const cards = [
    {
      label: 'Pendentes',
      value: data.cobrancas.pendentes,
      sub: data.cobrancas.valorPendentes.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }),
      color: 'bg-amber-50 border-amber-200',
    },
    {
      label: 'Pagas',
      value: data.cobrancas.pagas,
      sub: data.cobrancas.valorPagos.toLocaleString('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }),
      color: 'bg-emerald-50 border-emerald-200',
    },
    {
      label: 'Atrasadas',
      value: data.cobrancas.atrasadas,
      sub: `${(
        (data.cobrancas.atrasadas / Math.max(1, data.cobrancas.pendentes + data.cobrancas.pagas)) *
        100
      ).toFixed(1)}%`,
      color: 'bg-rose-50 border-rose-200',
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className={`border rounded-lg p-4 flex flex-col ${c.color} shadow-sm min-h-[110px]`}
        >
          <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            {c.label}
          </span>
          <span className="mt-2 text-2xl font-semibold">{c.value}</span>
          <span className="text-xs text-gray-600 mt-1">{c.sub}</span>
        </div>
      ))}
    </div>
  );
}
