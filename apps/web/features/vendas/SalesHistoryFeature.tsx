'use client';

import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { formatFirstLast } from '@alusa/lib/client';
import type { StoreSaleDTO } from '@alusa/finance';

import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';
import Pagination from '@/components/layout/Pagination';
import TableLayout from '@/components/layout/TableLayout';
import { Filter, RotateCcw, Search } from '@/components/icons/icons';
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
  'h-10 rounded-xl border-slate-200 bg-white text-slate-700 shadow-none';
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
        width: 'w-[9%]',
        align: 'left',
        render: (sale) => (
          <span className="font-medium text-slate-900">{formatSaleNumber(sale.saleNumber)}</span>
        ),
      },
      {
        id: 'data',
        header: 'Data',
        width: 'w-[12%]',
        align: 'left',
        render: (sale) => <span className="text-slate-700">{formatDateBR(sale.createdAt)}</span>,
      },
      {
        id: 'produto',
        header: 'Produto',
        width: 'w-[18%]',
        align: 'left',
        render: (sale) => <span className="text-slate-700">{formatProductSummary(sale)}</span>,
      },
      {
        id: 'cliente',
        header: 'Cliente',
        width: 'w-[17%]',
        align: 'left',
        render: (sale) => (
          <span className="font-medium text-slate-900">
            {formatFirstLast(sale.customer.displayName) || sale.customer.displayName}
          </span>
        ),
      },
      {
        id: 'pagamento',
        header: 'Pagamento',
        width: 'w-[18%]',
        align: 'left',
        render: (sale) => <span className="text-slate-700">{formatPaymentSummary(sale)}</span>,
      },
      {
        id: 'total',
        header: 'Total',
        width: 'w-[10%]',
        align: 'right',
        render: (sale) => (
          <span className="font-semibold text-slate-900">{formatCurrencyBRL(sale.total)}</span>
        ),
      },
      {
        id: 'lucro',
        header: 'Lucro',
        width: 'w-[10%]',
        align: 'right',
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
        width: 'w-[11%]',
        align: 'left',
        render: (sale) => <SaleStatusBadge status={sale.status} />,
      },
    ],
    [],
  );

  const clearFilters = () => {
    setSearch('');
    setStatus('TODOS');
    setFinalizationType('TODOS');
    setFromDate(undefined);
    setToDate(undefined);
    setPage(1);
  };

  return (
    <>
      <TableLayout
        title="Histórico da Loja"
        subtitle="Acompanhe os registros da Loja, filtre por período e abra os detalhes sempre que precisar."
        actions={
          <Button
            asChild
            className="h-10 bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90"
          >
            <Link href="/vendas/nova">Nova venda</Link>
          </Button>
        }
        filtersBar={
          <div className="flex w-full flex-col gap-3">
            <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative min-w-0 w-full sm:flex-1 xl:max-w-[420px]">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Buscar por cliente, número da venda ou produto"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="h-10 rounded-xl border-slate-200 bg-white pl-10 shadow-none"
                />
              </div>

              <div className="flex flex-nowrap items-center gap-2 sm:ml-auto sm:justify-end">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="h-10 shrink-0 whitespace-nowrap rounded-xl border-slate-200 px-4 shadow-none"
                    >
                      <Filter className="mr-2 h-4 w-4" />
                      {activeFilters > 0 ? `Filtros (${activeFilters})` : 'Filtros'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    className="w-[360px] rounded-2xl border-slate-200 p-4"
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
                              className="h-10 rounded-xl border-slate-200 bg-white shadow-none"
                            />
                          </div>

                          <div className="space-y-2">
                            <label className={FILTER_LABEL_CLASS}>Até</label>
                            <DatePicker
                              value={toDate}
                              onChange={setToDate}
                              variant="input"
                              placeholder="Data final"
                              className="h-10 rounded-xl border-slate-200 bg-white shadow-none"
                            />
                          </div>
                        </div>
                      </div>

                      <div className="flex justify-end">
                        <Button
                          type="button"
                          variant="outline"
                          className="h-9 rounded-xl border-slate-200 px-3 shadow-none"
                          onClick={clearFilters}
                          disabled={!hasRefinements}
                        >
                          <RotateCcw className="mr-2 h-4 w-4" />
                          Limpar filtros
                        </Button>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>

                <Button
                  type="button"
                  variant="outline"
                  className="h-10 shrink-0 whitespace-nowrap rounded-xl border-slate-200 px-4 shadow-none"
                  onClick={clearFilters}
                  disabled={!hasRefinements}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Limpar
                </Button>
              </div>
            </div>

            {hasRefinements ? (
              <div className="flex flex-wrap items-center gap-2">
                {hasSearch ? (
                  <Badge
                    variant="outline"
                    className="rounded-full px-2.5 py-1 text-[11px] font-medium text-slate-600"
                  >
                    Busca: {deferredSearch}
                  </Badge>
                ) : null}
                {status !== 'TODOS' ? (
                  <Badge
                    variant="outline"
                    className="rounded-full px-2.5 py-1 text-[11px] font-medium text-slate-600"
                  >
                    Status: {STATUS_LABELS[status]}
                  </Badge>
                ) : null}
                {finalizationType !== 'TODOS' ? (
                  <Badge
                    variant="outline"
                    className="rounded-full px-2.5 py-1 text-[11px] font-medium text-slate-600"
                  >
                    Finalização: {FINALIZATION_FILTER_LABELS[finalizationType]}
                  </Badge>
                ) : null}
                {fromDate ? (
                  <Badge
                    variant="outline"
                    className="rounded-full px-2.5 py-1 text-[11px] font-medium text-slate-600"
                  >
                    De: {formatDateBR(fromDate.toISOString())}
                  </Badge>
                ) : null}
                {toDate ? (
                  <Badge
                    variant="outline"
                    className="rounded-full px-2.5 py-1 text-[11px] font-medium text-slate-600"
                  >
                    Até: {formatDateBR(toDate.toISOString())}
                  </Badge>
                ) : null}
              </div>
            ) : null}
          </div>
        }
        footer={<Pagination total={total} page={page} pageSize={PAGE_SIZE} onChange={setPage} />}
      >
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Registros da Loja</h2>
              <p className="mt-1 text-xs text-slate-500">
                Clique em uma linha para abrir a página completa da venda.
              </p>
            </div>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
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
            bodyClassName="[&_td]:py-5"
            emptyMessage={
              <div className="px-6 py-12 text-center text-sm text-slate-500">
                Nenhuma venda encontrada com os filtros atuais.
              </div>
            }
            onRowClick={(sale) => router.push(`/vendas/${sale.id}`)}
          />
        </div>
      </TableLayout>
    </>
  );
}
