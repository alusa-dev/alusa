'use client';

import { useEffect, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { wizardSoftCheckboxClass } from '@/components/shared/wizard/field-styles';

type Discount = { id: string; nome: string; tipo: 'FIXO' | 'PERCENTUAL'; valor: number; escopo: string };

export function RenewalDiscountSelector({
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
    <div className="space-y-2">
      <div>
        <p className="text-sm font-medium text-slate-700 alusa-dark:text-[color:var(--color-text-primary)]">Descontos e benefícios</p>
        <p className="text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">Selecione os descontos que serão aplicados às novas matrículas. Nenhum desconto atual é herdado automaticamente.</p>
      </div>
      {error && <p className="text-xs text-red-600 alusa-dark:text-red-400">{error}</p>}
      {!error && items.length === 0 && <p className="text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">Nenhum desconto ativo cadastrado.</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <label key={item.id} className="flex cursor-pointer items-center gap-3 rounded-[10px] bg-[#eff3f8] p-3 text-sm text-slate-700 hover:bg-[#e7edf5] alusa-dark:bg-[color:var(--color-bg-elevated)] alusa-dark:text-[color:var(--color-text-primary)] alusa-dark:hover:bg-slate-700">
            <Checkbox className={wizardSoftCheckboxClass} checked={selectedIds.includes(item.id)} onCheckedChange={(checked) => toggle(item.id, Boolean(checked))} />
            <span className="min-w-0 flex-1 truncate">{item.nome}</span>
            <span className="text-xs text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">{item.tipo === 'PERCENTUAL' ? `${item.valor}%` : `R$ ${item.valor.toFixed(2)}`}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
