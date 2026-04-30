'use client';

import type { ExtratoFiltersState } from '../hooks/useExtratoFilters';

interface ExtratoHeaderProps {
  filters: ExtratoFiltersState;
}

export function ExtratoHeader({ filters }: ExtratoHeaderProps) {
  void filters;

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-5 md:px-6">
      <div className="max-w-2xl">
        <h1 className="text-[22px] md:text-[24px] font-semibold text-gray-900">Extrato</h1>
        <p className="mt-1 text-[13px] leading-5 text-slate-600">
          Esta visão mostra apenas movimentações que impactaram o saldo oficial da subconta. Pagamentos confirmados fora do ledger, como baixa manual em dinheiro, podem alterar a cobrança sem aparecer aqui.
        </p>
      </div>
    </div>
  );
}
