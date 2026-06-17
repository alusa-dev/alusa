'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye } from '@/components/icons/icons';
import { ChargeDisplayStatusBadge } from '@/components/financeiro/ChargeDisplayStatusBadge';
import Pagination from '@/components/layout/Pagination';
import { cn } from '@/lib/cn';
import {
  PRIMARY_PAYMENT_HISTORY_CATEGORIES,
  PAYMENT_HISTORY_CATEGORY_LABELS,
  type PaymentHistoryCategory,
} from '@/features/financeiro/pagamentos/payment-history-categories';
import {
  formatCurrency,
  formatDate,
  getCategoryLabel,
  isPaidStatus,
  resolveValorExibido,
  type HistoricoCobranca,
} from '@/features/financeiro/pagamentos/payment-history-utils';

const PAYMENT_HISTORY_PAGE_SIZE = 3;
const PAYMENT_HISTORY_PAGINATION_THRESHOLD = 4;
const PAYMENT_HISTORY_ROW_GRID =
  'grid grid-cols-[minmax(0,1fr)_92px_100px_100px_108px_44px] items-center gap-x-4';

type PaymentHistorySectionsProps = {
  cobrancas: HistoricoCobranca[];
  showEmptyCategories?: boolean;
};

export function PaymentHistorySections({
  cobrancas,
  showEmptyCategories = true,
}: PaymentHistorySectionsProps) {
  const router = useRouter();
  const grouped = new Map<PaymentHistoryCategory, HistoricoCobranca[]>();

  for (const cobranca of cobrancas) {
    const current = grouped.get(cobranca.category) ?? [];
    current.push(cobranca);
    grouped.set(cobranca.category, current);
  }

  const categories: PaymentHistoryCategory[] = [
    ...PRIMARY_PAYMENT_HISTORY_CATEGORIES,
    ...(grouped.has('OUTROS') ? (['OUTROS'] as const) : []),
  ];

  return (
    <div className="space-y-8">
      {categories.map((category) => {
        const items = grouped.get(category) ?? [];
        if (!showEmptyCategories && items.length === 0) return null;

        return (
          <PaymentHistorySection
            key={category}
            category={category}
            items={items}
            onOpenDetail={(href) => router.push(href)}
          />
        );
      })}
    </div>
  );
}

function PaymentHistorySection({
  category,
  items,
  onOpenDetail,
}: {
  category: PaymentHistoryCategory;
  items: HistoricoCobranca[];
  onOpenDetail: (_href: string) => void;
}) {
  const [page, setPage] = useState(1);
  const shouldPaginate = items.length >= PAYMENT_HISTORY_PAGINATION_THRESHOLD;
  const totalPages = shouldPaginate ? Math.ceil(items.length / PAYMENT_HISTORY_PAGE_SIZE) : 1;
  const currentPage = Math.min(page, totalPages);
  const visibleItems = shouldPaginate
    ? items.slice((currentPage - 1) * PAYMENT_HISTORY_PAGE_SIZE, currentPage * PAYMENT_HISTORY_PAGE_SIZE)
    : items;

  useEffect(() => {
    setPage(1);
  }, [items.length, category]);

  const totalGrupo = items.reduce((sum, item) => sum + (item.pagamento ? item.pagamento.valorPago : 0), 0);
  const pagas = items.filter((item) => isPaidStatus(item.displayStatus?.status ?? item.asaasStatus ?? item.pagamento?.status ?? item.status)).length;
  const label = PAYMENT_HISTORY_CATEGORY_LABELS[category];

  return (
    <section>
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="flex items-center gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-gray-800">{label}</h2>
          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-500">
            {items.length} {items.length === 1 ? 'cobrança' : 'cobranças'}
          </span>
          {pagas > 0 ? (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
              {pagas} paga{pagas > 1 ? 's' : ''}
            </span>
          ) : null}
        </div>
        {totalGrupo > 0 ? (
          <span className="text-[13px] font-semibold text-gray-700">{formatCurrency(totalGrupo)}</span>
        ) : null}
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-5 py-8 text-center">
          <p className="text-[13px] text-gray-500">Nenhum pagamento nesta categoria.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div
            className={cn(
              PAYMENT_HISTORY_ROW_GRID,
              'border-b border-gray-100 bg-gray-50 px-5 py-2.5',
            )}
          >
            <span className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Descrição</span>
            <span className="text-right text-[11px] font-medium uppercase tracking-wide text-gray-400">Valor</span>
            <span className="text-center text-[11px] font-medium uppercase tracking-wide text-gray-400">
              Vencimento
            </span>
            <span className="text-center text-[11px] font-medium uppercase tracking-wide text-gray-400">
              Data pag.
            </span>
            <span className="text-center text-[11px] font-medium uppercase tracking-wide text-gray-400">Status</span>
            <span className="text-right text-[11px] font-medium uppercase tracking-wide text-gray-400">Ações</span>
          </div>
          <div className="divide-y divide-gray-100">
            {visibleItems.map((cobranca) => (
              <PaymentHistoryRow key={`${cobranca.sourceKind}:${cobranca.sourceId}`} cobranca={cobranca} onOpenDetail={onOpenDetail} />
            ))}
          </div>
          {shouldPaginate && totalPages > 1 ? (
            <div className="border-t border-gray-100 bg-gray-50/50 px-5 py-3">
              <Pagination
                total={items.length}
                page={currentPage}
                pageSize={PAYMENT_HISTORY_PAGE_SIZE}
                onChange={setPage}
              />
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function PaymentHistoryRow({
  cobranca,
  onOpenDetail,
}: {
  cobranca: HistoricoCobranca;
  onOpenDetail: (_href: string) => void;
}) {
  const displayStatus = cobranca.displayStatus;
  const valor = resolveValorExibido(cobranca);
  const paga = isPaidStatus(displayStatus?.status ?? cobranca.asaasStatus ?? cobranca.pagamento?.status ?? cobranca.status);

  return (
    <button
      type="button"
      onClick={() => onOpenDetail(cobranca.detailHref)}
      className={cn(
        PAYMENT_HISTORY_ROW_GRID,
        'group w-full border-0 bg-transparent px-5 py-3 text-left transition-colors hover:bg-gray-50/60',
        'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-purple-500/30',
      )}
      title="Ver cobrança"
      aria-label={`Ver cobrança: ${cobranca.description || getCategoryLabel(cobranca.category)}`}
    >
      <div className="min-w-0">
        <p className="truncate text-[13px] leading-snug text-gray-900">
          {cobranca.description || getCategoryLabel(cobranca.category)}
        </p>
      </div>

      <div
        className={cn(
          'text-right text-[13px] font-semibold tabular-nums',
          paga ? 'text-emerald-700' : 'text-gray-900',
        )}
      >
        {formatCurrency(valor)}
      </div>

      <div className="text-center text-[13px] tabular-nums text-gray-600">{formatDate(cobranca.vencimento)}</div>

      <div className="text-center text-[13px] tabular-nums text-gray-700">
        {cobranca.pagamento?.dataPagamento ? (
          <span>{formatDate(cobranca.pagamento.dataPagamento)}</span>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </div>

      <div className="flex justify-center">
        {displayStatus ? <ChargeDisplayStatusBadge displayStatus={displayStatus} size="sm" /> : null}
      </div>

      <div className="flex justify-end">
        <span
          className="inline-flex rounded-lg p-1.5 text-gray-400 transition-colors group-hover:bg-purple-50 group-hover:text-purple-700"
          aria-hidden
        >
          <Eye className="h-4 w-4" />
        </span>
      </div>
    </button>
  );
}
