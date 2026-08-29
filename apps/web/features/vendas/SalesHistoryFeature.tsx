'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { formatFirstLast } from '@alusa/lib/client';
import type { StoreSaleDTO } from '@alusa/finance';

import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';
import Pagination from '@/components/layout/Pagination';
import TableLayout from '@/components/layout/TableLayout';
import { Filter, Search, ShoppingBag } from '@/components/icons/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { usePlatformBillingWriteAccess } from '@/hooks/use-platform-billing-write-access';

import { SaleStatusBadge } from './components/SaleStatusBadge';
import {
  BILLING_TYPE_LABELS,
  formatCurrencyBRL,
  formatDateBR,
  formatSaleNumber,
  listSales,
  SALE_FINALIZATION_LABELS,
  SALE_PAYMENT_METHOD_LABELS,
  type CurrentSaleStatusFilter,
  type SaleFinalizationValue,
} from './services/sales-service';

const PAGE_SIZE = 10;
const TOOLBAR_TRIGGER_CLASS =
  'h-10 rounded-lg border-slate-200 bg-white text-slate-700 shadow-none';
const FILTER_LABEL_CLASS = 'text-[11px] font-medium uppercase tracking-wide text-slate-400';
const STATUS_LABELS: Record<CurrentSaleStatusFilter, string> = {
  TODOS: 'Todos os status',
  CONCLUIDA: 'Concluídas',
  PENDENTE: 'Pendentes',
  CANCELADA: 'Canceladas',
};

const FINALIZATION_FILTER_LABELS: Record<SaleFinalizationValue | 'TODOS', string> = {
  TODOS: 'Todas as finalizações',
  RECEBIMENTO_PRESENCIAL: SALE_FINALIZATION_LABELS.RECEBIMENTO_PRESENCIAL,
  COBRANCA: SALE_FINALIZATION_LABELS.COBRANCA,
};

function toDateString(value: Date | undefined): string | undefined {
  if (!value) return undefined;
  return value.toISOString().slice(0, 10);
}

function formatProductSummary(sale: StoreSaleDTO): string {
  const firstProduct = sale.items[0]?.productName ?? 'Sem produto';

  if (sale.items.length <= 1) {
    return firstProduct;
  }

  return `${firstProduct} +${sale.items.length - 1}`;
}

function formatPaymentSummary(sale: StoreSaleDTO): string {
  if (sale.finalizationType === 'RECEBIMENTO_PRESENCIAL' && sale.paymentMethod) {
    return `${SALE_FINALIZATION_LABELS[sale.finalizationType]} · ${SALE_PAYMENT_METHOD_LABELS[sale.paymentMethod]}`;
  }

  if (sale.finalizationType === 'COBRANCA' && sale.installmentPlan) {
    const billingType =
      BILLING_TYPE_LABELS[sale.installmentPlan.billingType as keyof typeof BILLING_TYPE_LABELS];
    return `${SALE_FINALIZATION_LABELS[sale.finalizationType]} · ${
      billingType ?? sale.installmentPlan.billingType
    } · ${sale.installmentPlan.installmentCount}x`;
  }

  if (sale.finalizationType === 'COBRANCA' && sale.charge?.billingType) {
    const billingType =
      BILLING_TYPE_LABELS[sale.charge.billingType as keyof typeof BILLING_TYPE_LABELS];
    return `${SALE_FINALIZATION_LABELS[sale.finalizationType]} · ${billingType ?? sale.charge.billingType}`;
  }

  return SALE_FINALIZATION_LABELS[sale.finalizationType];
}

export function SalesHistoryFeature() {
  const { canWrite, loading: billingLoading } = usePlatformBillingWriteAccess();
  const router = useRouter();
  const [items, setItems] = useState<StoreSaleDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<CurrentSaleStatusFilter>('TODOS');
  const [finalizationType, setFinalizationType] = useState<SaleFinalizationValue | 'TODOS'>(
    'TODOS',
  );
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);
  const deferredSearch = useDeferredValue(search);
  const activeFilters = useMemo(
    () =>
      [status !== 'TODOS', finalizationType !== 'TODOS', Boolean(fromDate), Boolean(toDate)].filter(
        Boolean,
      ).length,
    [finalizationType, fromDate, status, toDate],
  );
  const hasSearch = deferredSearch.trim().length > 0;
  const hasRefinements = hasSearch || activeFilters > 0;

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const result = await listSales({
          page,
          pageSize: PAGE_SIZE,
          search: deferredSearch,
          status,
          finalizationType,
          fromDate: toDateString(fromDate),
          toDate: toDateString(toDate),
        });

        setItems(result.data);
        setTotal(result.meta.total);
      } catch (error) {
        toast.error({ title: 'Erro ao carregar histórico', description: (error as Error).message });
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [deferredSearch, finalizationType, fromDate, page, status, toDate]);

  useEffect(() => {
    setPage(1);
  }, [deferredSearch, status, finalizationType, fromDate, toDate]);

  const columns: DataTableColumn<StoreSaleDTO>[] = useMemo(
    () => [
      {
        id: 'numero',
        header: 'Venda',
        width: 'min-w-0 lg:w-[12%]',
        align: 'left',
        render: (sale) => (
          <div className="min-w-0">
            <span className="font-medium text-slate-900">{formatSaleNumber(sale.saleNumber)}</span>
            <div className="mt-1 space-y-0.5 lg:hidden">
              <p className="text-xs text-slate-600">{formatDateBR(sale.createdAt)}</p>
              <p className="truncate text-xs text-slate-600">{formatProductSummary(sale)}</p>
              <p className="truncate text-xs font-medium text-slate-900">
                {formatFirstLast(sale.customer.displayName) || sale.customer.displayName}
              </p>
              <p className="text-xs font-semibold text-slate-900">{formatCurrencyBRL(sale.total)}</p>
              <p className="line-clamp-2 text-[11px] text-slate-500">{formatPaymentSummary(sale)}</p>
              {sale.grossProfit != null ? (
                <p
                  className={
                    sale.grossProfit >= 0 ? 'text-xs font-semibold text-emerald-700' : 'text-xs font-semibold text-red-700'
                  }
                >
                  Lucro {formatCurrencyBRL(sale.grossProfit)}
                </p>
              ) : null}
            </div>
          </div>
        ),
      },
      {
        id: 'data',
        header: 'Data',
        width: 'lg:w-[10%]',
        align: 'left',
        headerClassName: 'hidden lg:table-cell',
        cellClassName: 'hidden lg:table-cell',
        render: (sale) => <span className="text-slate-700">{formatDateBR(sale.createdAt)}</span>,
      },
      {
        id: 'produto',
        header: 'Produto',
        width: 'lg:w-[15%]',
        align: 'left',
        headerClassName: 'hidden lg:table-cell',
        cellClassName: 'hidden lg:table-cell',
        render: (sale) => (
          <span className="block truncate text-slate-700" title={formatProductSummary(sale)}>
            {formatProductSummary(sale)}
          </span>
        ),
      },
      {
        id: 'cliente',
        header: 'Cliente',
        width: 'lg:w-[15%]',
        align: 'left',
        headerClassName: 'hidden lg:table-cell',
        cellClassName: 'hidden lg:table-cell',
        render: (sale) => (
          <span
            className="block truncate font-medium text-slate-900"
            title={sale.customer.displayName}
          >
            {formatFirstLast(sale.customer.displayName) || sale.customer.displayName}
          </span>
        ),
      },
      {
        id: 'pagamento',
        header: 'Pagamento',
        width: 'lg:w-[20%]',
        align: 'left',
        headerClassName: 'hidden lg:table-cell',
        cellClassName: 'hidden lg:table-cell',
        render: (sale) => (
          <span className="block truncate text-slate-700" title={formatPaymentSummary(sale)}>
            {formatPaymentSummary(sale)}
          </span>
        ),
      },
      {
        id: 'total',
        header: 'Total',
        width: 'lg:w-[10%]',
        align: 'right',
        headerClassName: 'hidden lg:table-cell',
        cellClassName: 'hidden lg:table-cell',
        render: (sale) => (
          <span className="font-semibold text-slate-900">{formatCurrencyBRL(sale.total)}</span>
        ),
      },
      {
        id: 'lucro',
        header: 'Lucro',
        width: 'lg:w-[8%]',
        align: 'right',
        headerClassName: 'hidden lg:table-cell',
        cellClassName: 'hidden lg:table-cell',
        render: (sale) => {
          if (sale.grossProfit == null) {
            return <span className="text-slate-300">—</span>;
          }

          return (
            <div
              className={
                sale.grossProfit >= 0
                  ? 'text-right font-semibold text-emerald-700'
                  : 'text-right font-semibold text-red-700'
              }
            >
              {formatCurrencyBRL(sale.grossProfit)}
            </div>
          );
        },
      },
      {
        id: 'status',
        header: 'Status',
        width: 'w-[36%] max-lg:shrink-0 lg:w-[10%]',
        align: 'left',
        headerClassName: 'max-lg:px-2',
        cellClassName: 'max-lg:px-2',
        render: (sale) => <SaleStatusBadge status={sale.status} />,
      },
    ],
    [],
  );

  return (
    <TableLayout
      title="Histórico da Loja"
      subtitle="Acompanhe as vendas realizadas e encontre rapidamente os detalhes de cada cobrança."
      actions={
        <>
          <Button
            disabled={billingLoading || !canWrite}
            className="h-10 w-full rounded-lg bg-primary px-4 text-white shadow-none hover:bg-primary/90 lg:w-auto"
            onClick={() => {
              window.location.assign('/vendas/nova');
            }}
          >
            <ShoppingBag className="mr-2 h-4 w-4" />
            Nova venda
          </Button>
        </>
      }
      filtersBar={
        <div className="flex w-full justify-end">
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <div className="relative min-w-0 w-full sm:w-[min(360px,42vw)] lg:w-[360px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Buscar cliente, venda ou produto"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-10 rounded-lg border-slate-200 bg-white pl-10 shadow-none placeholder:text-slate-400"
              />
            </div>
            <div className="grid w-full grid-cols-1 sm:w-auto">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="h-10 w-full min-w-0 shrink-0 rounded-lg border-slate-200 px-4 shadow-none sm:w-auto"
                    >
                      <Filter className="mr-2 h-4 w-4" />
                      {activeFilters > 0 ? `Filtros (${activeFilters})` : 'Filtros'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    className="w-[min(360px,calc(100vw-2rem))] rounded-xl border-slate-200 p-5"
                  >
                    <div className="space-y-4">
                      <div>
                        <div className="text-sm font-semibold text-slate-900">
                          Refinar histórico
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          Ajuste status, finalização e período para encontrar a venda certa mais
                          rápido.
            </div>
          </div>

                      <div className="space-y-3">
                        <div className="space-y-2">
                          <label className={FILTER_LABEL_CLASS}>Status</label>
                          <Select
                            value={status}
                            onValueChange={(value: CurrentSaleStatusFilter) => setStatus(value)}
                          >
                            <SelectTrigger className={TOOLBAR_TRIGGER_CLASS}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                                <SelectItem key={value} value={value}>
                                  {label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-2">
                          <label className={FILTER_LABEL_CLASS}>Finalização</label>
                          <Select
                            value={finalizationType}
                            onValueChange={(value: SaleFinalizationValue | 'TODOS') =>
                              setFinalizationType(value)
                            }
                          >
                            <SelectTrigger className={TOOLBAR_TRIGGER_CLASS}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.entries(FINALIZATION_FILTER_LABELS).map(([value, label]) => (
                                <SelectItem key={value} value={value}>
                                  {label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <label className={FILTER_LABEL_CLASS}>De</label>
                            <DatePicker
                              value={fromDate}
                              onChange={setFromDate}
                              variant="input"
                              placeholder="Data inicial"
                          className="h-10 rounded-lg border-slate-200 bg-white shadow-none"
                            />
                          </div>

                          <div className="space-y-2">
                            <label className={FILTER_LABEL_CLASS}>Até</label>
                            <DatePicker
                              value={toDate}
                              onChange={setToDate}
                              variant="input"
                              placeholder="Data final"
                              className="h-10 rounded-lg border-slate-200 bg-white shadow-none"
                            />
                          </div>
                        </div>
                      </div>

                    </div>
                  </PopoverContent>
                </Popover>

            </div>

            {hasRefinements ? (
              <div className="flex flex-wrap items-center gap-2">
                {hasSearch ? (
                  <Badge
                    variant="outline"
                    className="rounded-full border-[#e6d6fb] bg-[#f8f3fd] px-2.5 py-1 text-[11px] font-medium text-[#4b217a]"
                  >
                    Busca: {deferredSearch}
                  </Badge>
                ) : null}
                {status !== 'TODOS' ? (
                  <Badge
                    variant="outline"
                    className="rounded-full border-[#e6d6fb] bg-[#f8f3fd] px-2.5 py-1 text-[11px] font-medium text-[#4b217a]"
                  >
                    Status: {STATUS_LABELS[status]}
                  </Badge>
                ) : null}
                {finalizationType !== 'TODOS' ? (
                  <Badge
                    variant="outline"
                    className="rounded-full border-[#e6d6fb] bg-[#f8f3fd] px-2.5 py-1 text-[11px] font-medium text-[#4b217a]"
                  >
                    Finalização: {FINALIZATION_FILTER_LABELS[finalizationType]}
                  </Badge>
                ) : null}
                {fromDate ? (
                  <Badge
                    variant="outline"
                    className="rounded-full border-[#e6d6fb] bg-[#f8f3fd] px-2.5 py-1 text-[11px] font-medium text-[#4b217a]"
                  >
                    De: {formatDateBR(fromDate.toISOString())}
                  </Badge>
                ) : null}
                {toDate ? (
                  <Badge
                    variant="outline"
                    className="rounded-full border-[#e6d6fb] bg-[#f8f3fd] px-2.5 py-1 text-[11px] font-medium text-[#4b217a]"
                  >
                    Até: {formatDateBR(toDate.toISOString())}
                  </Badge>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      }
      footer={<Pagination total={total} page={page} pageSize={PAGE_SIZE} onChange={setPage} />}
    >
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between md:px-6">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Registros da Loja</h2>
            <p className="mt-1 text-xs text-slate-500">
              Clique em uma linha para abrir os detalhes completos da venda.
            </p>
          </div>
          <div className="text-xs font-medium uppercase tracking-[0.08em] text-slate-400">
            {total} registro(s)
          </div>
        </div>
        <DataTable
          columns={columns}
          data={items}
          rowKey={(sale) => sale.id}
          loading={loading}
          skeletonRows={8}
          ariaLabel="Histórico da Loja"
          bodyClassName="[&_td]:py-4"
          emptyMessage={
            <div className="px-6 py-12 text-center text-sm text-slate-500">
              Nenhuma venda encontrada com os filtros atuais.
            </div>
          }
          onRowClick={(sale) => router.push(`/vendas/${sale.id}`)}
        />
      </div>
    </TableLayout>
  );
}
