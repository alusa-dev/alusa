'use client';

import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { InventoryMovementType } from '@prisma/client';

import { ArrowPrev, Download, Filter, Search } from '@/components/icons/icons';
import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';
import TableLayout from '@/components/layout/TableLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

import { listInventoryMovements, type InventoryMovementItem } from './services/inventory-service';
import { exportInventoryHistoryPdf } from './inventory-history-pdf';
import {
  formatInventoryCurrency,
  formatInventoryDateTime,
  formatOriginLabel,
  formatSignedQuantity,
  MOVEMENT_BADGE_VARIANTS,
  MOVEMENT_LABELS,
} from './inventory-ui';

function toDateString(value: Date | undefined): string | undefined {
  if (!value) return undefined;
  return format(value, 'yyyy-MM-dd');
}

function toDateInputValue(value: Date | undefined): string {
  return value ? format(value, 'yyyy-MM-dd') : '';
}

function parseDateInput(value: string): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(`${value}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function InventoryHistoryFeature() {
  const searchParams = useSearchParams();
  const presetProductId = searchParams.get('productId') || undefined;
  const presetVariantId = searchParams.get('variantId') || undefined;

  const [items, setItems] = useState<InventoryMovementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [movementType, setMovementType] = useState<InventoryMovementType | 'TODOS'>('TODOS');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);
  const [exporting, setExporting] = useState(false);

  async function loadData() {
    setLoading(true);
    try {
      const data = await listInventoryMovements({
        productId: presetProductId,
        variantId: presetVariantId,
        search,
        movementType: movementType === 'TODOS' ? undefined : movementType,
        fromDate: toDateString(fromDate),
        toDate: toDateString(toDate),
        limit: 200,
      });
      setItems(data);
    } catch (error) {
      toast.error({ title: 'Erro ao carregar histórico', description: (error as Error).message });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, movementType, fromDate, toDate, presetProductId, presetVariantId]);

  const activeFilters = useMemo(
    () =>
      [Boolean(search.trim()), movementType !== 'TODOS', Boolean(fromDate), Boolean(toDate)].filter(
        Boolean,
      ).length,
    [search, movementType, fromDate, toDate],
  );

  const sortedItems = useMemo(() => {
    return [...items].sort((left, right) => {
      const leftTime = new Date(left.createdAt).getTime();
      const rightTime = new Date(right.createdAt).getTime();
      return direction === 'desc' ? rightTime - leftTime : leftTime - rightTime;
    });
  }, [direction, items]);

  function clearFilters() {
    setSearch('');
    setMovementType('TODOS');
    setFromDate(undefined);
    setToDate(undefined);
    setDirection('desc');
  }

  async function handleExport() {
    if (!sortedItems.length) {
      toast.warning({
        title: 'Nada para exportar',
        description: 'Aplique filtros ou aguarde o carregamento do histórico.',
      });
      return;
    }

    setExporting(true);
    try {
      await exportInventoryHistoryPdf({
        items: sortedItems,
        search,
        movementType,
        fromDate,
        toDate,
        direction,
      });
    } catch (error) {
      toast.error({
        title: 'Não foi possível exportar o PDF',
        description: (error as Error).message,
      });
    } finally {
      setExporting(false);
    }
  }

  const columns: DataTableColumn<InventoryMovementItem>[] = [
    {
      id: 'item',
      header: 'Produto',
      width: 'w-[27%]',
      align: 'left',
      noWrap: false,
      render: (item) => (
        <div className="min-w-0 space-y-1">
          <div className="font-normal text-[13px] text-gray-900">
            {item.productName}
            {item.variantTitle ? ` · ${item.variantTitle}` : ''}
          </div>
          <div className="text-xs text-gray-500">
            {formatOriginLabel(item.originType, item.originActionKey)}
          </div>
        </div>
      ),
    },
    {
      id: 'type',
      header: 'Movimento',
      align: 'center',
      width: 'w-[14%]',
      render: (item) => (
        <Badge variant={MOVEMENT_BADGE_VARIANTS[item.movementType]} size="sm">
          {MOVEMENT_LABELS[item.movementType]}
        </Badge>
      ),
    },
    {
      id: 'balance',
      header: 'Saldo',
      align: 'right',
      width: 'w-[19%]',
      noWrap: false,
      render: (item) => (
        <div className="space-y-1">
          <div
            className="financial-data flex items-center justify-end gap-1.5 font-medium text-slate-900"
          >
            <span className="sr-only">Saldo anterior </span>
            <span>{item.onHandBefore}</span>
            <span aria-hidden className="text-slate-400">→</span>
            <span className="sr-only">Saldo final </span>
            <span>{item.onHandAfter}</span>
          </div>
          <div className="text-xs text-slate-500">
            Variação:{' '}
            <span
              className={`financial-data ${item.onHandDelta >= 0 ? 'text-emerald-700' : 'text-red-700'}`}
            >
              {formatSignedQuantity(item.onHandDelta)}
            </span>
          </div>
        </div>
      ),
    },
    {
      id: 'cost',
      header: 'Custo',
      align: 'right',
      width: 'w-[12%]',
      render: (item) => item.totalCost != null ? <span className="financial-data">{formatInventoryCurrency(item.totalCost)}</span> : '—',
    },
    {
      id: 'actor',
      header: 'Responsável',
      align: 'left',
      width: 'w-[13%]',
      render: (item) => item.actor.name || 'Sistema',
    },
    {
      id: 'date',
      header: 'Data/hora',
      align: 'left',
      width: 'w-[15%]',
      headerClassName: 'whitespace-nowrap',
      render: (item) => formatInventoryDateTime(item.createdAt),
    },
  ];

  return (
    <div className="space-y-4">
      <Link
        href="/sales/inventory"
        className="inline-flex items-center gap-2 text-sm text-gray-600 transition-colors hover:text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
      >
        <ArrowPrev className="h-4 w-4" />
        Voltar
      </Link>
      <TableLayout
        title="Histórico de estoque"
        subtitle="Auditoria operacional com saldo anterior, mudança, saldo final, custo e responsável."
        actions={
          <Button
            type="button"
            onClick={() => void handleExport()}
            disabled={exporting || loading || sortedItems.length === 0}
            className="h-10 w-full bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90 disabled:opacity-50 md:w-auto"
          >
            <Download className="mr-2 h-4 w-4" />
            {exporting ? 'Exportando...' : 'Exportar Dados'}
          </Button>
        }
        filtersBar={
          <div className="flex w-full flex-col gap-3 lg:flex-row lg:items-center lg:justify-end">
            <div className="relative w-full lg:w-[400px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="h-10 rounded-lg border-slate-200 bg-white pl-9 text-sm shadow-none focus-visible:border-brand-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-accent"
                placeholder="Buscar por produto, motivo ou origem"
              />
            </div>

            <div className="flex w-full flex-col gap-3 lg:w-auto lg:flex-row">
              <Select
                value={direction}
                onValueChange={(value) => setDirection(value as 'asc' | 'desc')}
              >
                <SelectTrigger className="h-10 w-full rounded-lg border-slate-200 bg-white shadow-none lg:w-[170px]">
                  <SelectValue placeholder="Ordem" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="desc">Mais recente</SelectItem>
                  <SelectItem value="asc">Mais antigo</SelectItem>
                </SelectContent>
              </Select>

              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="relative h-10 w-full whitespace-nowrap rounded-lg border-slate-200 bg-white px-4 shadow-none lg:w-auto"
                  >
                    <Filter className="mr-2 h-4 w-4" />
                    Filtros avançados
                    {activeFilters > 0 ? (
                      <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-xs text-white">
                        {activeFilters}
                      </span>
                    ) : null}
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  className="w-80 rounded-xl border-slate-200 p-4 shadow-[0_8px_30px_rgba(15,23,42,0.12)]"
                  align="end"
                  sideOffset={10}
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-slate-900">Refinar histórico</h4>
                      {activeFilters > 0 ? (
                        <button
                          type="button"
                          onClick={clearFilters}
                          className="text-xs font-medium text-slate-600 hover:text-slate-900"
                        >
                          Limpar tudo
                        </button>
                      ) : null}
                    </div>

                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-gray-500">Data inicial</label>
                        <Input
                          type="date"
                          value={toDateInputValue(fromDate)}
                          onChange={(event) => setFromDate(parseDateInput(event.target.value))}
                          className="h-9 rounded-lg border-slate-200 bg-white"
                          max={toDate ? toDateInputValue(toDate) : undefined}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-gray-500">Data final</label>
                        <Input
                          type="date"
                          value={toDateInputValue(toDate)}
                          onChange={(event) => setToDate(parseDateInput(event.target.value))}
                          className="h-9 rounded-lg border-slate-200 bg-white"
                          min={fromDate ? toDateInputValue(fromDate) : undefined}
                        />
                      </div>

                      <div className="space-y-1.5 border-t border-slate-100 pt-3">
                        <label className="text-xs font-medium text-gray-500">Movimento</label>
                        <Select
                          value={movementType}
                          onValueChange={(value: InventoryMovementType | 'TODOS') =>
                            setMovementType(value)
                          }
                        >
                          <SelectTrigger className="h-9 w-full rounded-lg border-slate-200 bg-white">
                            <SelectValue placeholder="Todos os movimentos" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="TODOS">Todos</SelectItem>
                            {Object.entries(MOVEMENT_LABELS).map(([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>

            </div>
          </div>
        }
      >
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <DataTable
            columns={columns}
            data={sortedItems}
            rowKey={(item) => item.id}
            tableClassName="min-w-[1200px]"
            loading={loading}
            emptyMessage={
              <div className="px-6 py-12 text-center text-sm text-gray-500">
                Nenhum movimento encontrado.
              </div>
            }
            ariaLabel="Tabela do histórico de estoque"
          />
        </div>
      </TableLayout>
    </div>
  );
}

export default InventoryHistoryFeature;
