'use client';

import { useEffect, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';

type Discount = { id: string; nome: string; tipo: 'FIXO' | 'PERCENTUAL'; valor: number; escopo: string };

export function RematriculaDiscountSelector({
  contaId,
  selectedIds,
  onChange,
}: {
  contaId?: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const [items, setItems] = useState<Discount[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!contaId) return;
    let cancelled = false;
    fetch('/api/descontos', { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { items?: Array<Record<string, unknown>>; error?: { message?: string } } | null;
        if (!response.ok) throw new Error(payload?.error?.message ?? 'Não foi possível carregar os descontos.');
        return (payload?.items ?? [])
          .map((item) => ({
            id: String(item.id ?? ''),
            nome: String(item.nome ?? 'Desconto'),
            tipo: item.tipo === 'FIXO' ? 'FIXO' as const : 'PERCENTUAL' as const,
            valor: Number(item.valor ?? 0),
            escopo: String(item.escopo ?? ''),
          }))
          .filter((item) => item.id);
      })
      .then((next) => { if (!cancelled) setItems(next); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Erro ao carregar descontos.'); });
    return () => { cancelled = true; };
  }, [contaId]);

  const toggle = (id: string, checked: boolean) => {
    onChange(checked ? Array.from(new Set([...selectedIds, id])) : selectedIds.filter((item) => item !== id));
  };

  return (
    <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
      <div>
        <p className="text-sm font-medium text-slate-700">Descontos e benefícios</p>
        <p className="text-xs text-slate-500">Selecione os descontos que serão aplicados às novas matrículas. Nenhum desconto atual é herdado automaticamente.</p>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {!error && items.length === 0 && <p className="text-xs text-slate-500">Nenhum desconto ativo cadastrado.</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
            <Checkbox checked={selectedIds.includes(item.id)} onCheckedChange={(checked) => toggle(item.id, Boolean(checked))} />
            <span className="min-w-0 flex-1 truncate">{item.nome}</span>
            <span className="text-xs text-slate-500">{item.tipo === 'PERCENTUAL' ? `${item.valor}%` : `R$ ${item.valor.toFixed(2)}`}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
