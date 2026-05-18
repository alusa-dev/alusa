'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight } from '@/components/icons/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  resolveStatus,
  resolveValorExibido,
  type HistoricoCobranca,
} from '@/features/financeiro/pagamentos/payment-history-utils';

const PAYMENT_HISTORY_PAGE_SIZE = 3;
const PAYMENT_HISTORY_PAGINATION_THRESHOLD = 4;

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
  const pagas = items.filter((item) => isPaidStatus(item.pagamento?.status ?? item.status)).length;
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
          <div className="grid grid-cols-[minmax(0,1fr)_120px_120px_130px_120px_44px] gap-0 border-b border-gray-100 bg-gray-50 px-5 py-2.5">
            {['Descrição', 'Valor', 'Vencimento', 'Data pag.', 'Status', ''].map((header) => (
              <span key={header} className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                {header}
              </span>
            ))}
          </div>
          <div className="divide-y divide-gray-100">
            {visibleItems.map((cobranca) => (
              <PaymentHistoryRow key={`${cobranca.sourceKind}:${cobranca.sourceId}`} cobranca={cobranca} onOpenDetail={onOpenDetail} />
            ))}
          </div>
          {shouldPaginate && totalPages > 1 ? (
            <PaymentHistorySectionPagination
              page={currentPage}
              totalPages={totalPages}
              totalItems={items.length}
              onPageChange={setPage}
            />
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
  const status = resolveStatus(cobranca);
  const valor = resolveValorExibido(cobranca);
  const paga = isPaidStatus(cobranca.pagamento?.status ?? '');

  return (
    <div className="group grid grid-cols-[minmax(0,1fr)_120px_120px_130px_120px_44px] items-center gap-0 px-5 py-3 transition-colors hover:bg-gray-50/60">
      <div className="min-w-0 pr-4">
        <p className="truncate text-[13px] leading-snug text-gray-900">
          {cobranca.description || getCategoryLabel(cobranca.category)}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {cobranca.installmentLabel ? (
            <p className="text-[11px] text-gray-400">{cobranca.installmentLabel}</p>
          ) : cobranca.installmentCount ? (
            <p className="text-[11px] text-gray-400">
              {cobranca.installmentsPaid ?? 0}/{cobranca.installmentCount} parcelas pagas
            </p>
          ) : null}
          {cobranca.planName ? (
            <p className="text-[11px] text-gray-400">{cobranca.planName}</p>
          ) : null}
          {cobranca.payerRole === 'RESPONSAVEL' ? (
            <p className="text-[11px] text-violet-600">Pago por: {cobranca.payerName}</p>
          ) : null}
        </div>
      </div>

      <div className={cn('text-[13px] font-semibold', paga ? 'text-emerald-700' : 'text-gray-900')}>
        {formatCurrency(valor)}
      </div>

      <div className="text-[13px] text-gray-500">{formatDate(cobranca.vencimento)}</div>

      <div className="text-[13px] text-gray-700">
        {cobranca.pagamento?.dataPagamento ? (
          <span>{formatDate(cobranca.pagamento.dataPagamento)}</span>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </div>

      <div>
        <Badge status={status} size="sm" />
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onOpenDetail(cobranca.detailHref)}
          className="rounded-lg p-1.5 text-gray-300 opacity-0 transition-colors hover:bg-purple-50 hover:text-purple-600 group-hover:opacity-100"
          title="Ver detalhes"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function PaymentHistorySectionPagination({
  page,
  totalPages,
  totalItems,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalItems: number;
  onPageChange: (_page: number) => void;
}) {
  return (
    <div
      className="flex items-center justify-between border-t border-gray-100 bg-gray-50/50 px-5 py-3"
      role="navigation"
      aria-label="Paginação da categoria"
    >
      <span className="text-xs font-medium text-gray-500">
        Página {page} de {totalPages} • {totalItems} {totalItems === 1 ? 'cobrança' : 'cobranças'}
      </span>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Anterior
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
        >
          Próxima
        </Button>
      </div>
    </div>
  );
}
