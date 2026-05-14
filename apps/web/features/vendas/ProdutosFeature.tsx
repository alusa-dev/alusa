'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import TableLayout from '@/components/layout/TableLayout';
import EntityFiltersBar, {
  type SortOrder,
  type StatusValue,
} from '@/components/layout/EntityFiltersBar';
import Pagination from '@/components/layout/Pagination';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Archive, ArchiveRestore, Edit3, Package2, Plus } from '@/components/icons/icons';
import ConfirmDeleteDialog from '@/components/dialogs/ConfirmDeleteDialog';
import { toast } from '@/components/ui/toast';
import { useDeleteDialog } from '@/hooks/use-delete-dialog';
import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';
import useCurrentUser from '@/hooks/use-current-user';
import { useProducts } from './hooks/use-products';
import { type ProductListItem } from './services/products-service';
import { formatMarginPercent } from './pricing-utils';

const PAGE_SIZE = 20;

type ProductViewMode = 'catalog' | 'archived';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function getProductReference(product: ProductListItem) {
  const sku = product.sku?.trim();

  if (sku) {
    return { label: 'SKU', value: sku };
  }

  return {
    label: 'ID',
    value: product.id.slice(0, 8).toUpperCase(),
  };
}

function getStockProgress(stock: number, threshold: number) {
  const safeThreshold = Math.max(threshold, 1);

  if (stock <= 0) {
    return {
      value: 0,
      trackClassName: 'bg-red-100',
      indicatorClassName: 'bg-red-500',
      label: 'Sem estoque',
    };
  }

  if (stock <= safeThreshold) {
    return {
      value: 42,
      trackClassName: 'bg-amber-100',
      indicatorClassName: 'bg-amber-500',
      label: 'Estoque baixo',
    };
  }

  return {
    value: 100,
    trackClassName: 'bg-emerald-100',
    indicatorClassName: 'bg-emerald-500',
    label: 'Estoque disponível',
  };
}

function getDerivedStockProgress(product: ProductListItem) {
  if (product.stockAlertState === 'OUT') {
    return {
      value: 0,
      trackClassName: 'bg-red-100',
      indicatorClassName: 'bg-red-500',
      label: 'Sem estoque',
    };
  }

  if (product.stockAlertState === 'LOW') {
    return {
      value: 42,
      trackClassName: 'bg-amber-100',
      indicatorClassName: 'bg-amber-500',
      label: product.hasVariants ? 'Variantes com estoque baixo' : 'Estoque baixo',
    };
  }

  return {
    value: 100,
    trackClassName: 'bg-emerald-100',
    indicatorClassName: 'bg-emerald-500',
    label: 'Estoque disponível',
  };
}

interface ProdutosTableProps {
  products: ProductListItem[];
  loading: boolean;
  searchTerm: string;
  viewMode: ProductViewMode;
  pendingIds: Set<string>;
  onEdit: (_product: ProductListItem) => void;
  onDelete: (_product: ProductListItem) => void;
  onToggleStatus: (_product: ProductListItem, _active: boolean) => void;
  onRestore: (_product: ProductListItem) => void;
}

function ProdutosTable({
  products,
  loading,
  searchTerm,
  viewMode,
  pendingIds,
  onEdit,
  onDelete,
  onToggleStatus,
  onRestore,
}: ProdutosTableProps) {
  const actionColumn = {
    id: 'actions',
    header: 'Ações',
    width: viewMode === 'archived' ? 'w-[7rem] max-lg:shrink-0 lg:w-[12%]' : 'w-[3.25rem] max-lg:shrink-0 lg:w-[16%]',
    align: 'right',
    headerClassName: 'max-lg:px-1',
    cellClassName: 'max-lg:px-1',
    skeleton: <div className="ml-auto h-8 w-28 rounded-lg bg-gray-200" />,
    render: (row: ProductListItem) => {
      const isPending = pendingIds.has(row.id);

      if (viewMode === 'archived') {
        return (
          <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 max-lg:px-2 max-lg:text-[11px] rounded-lg px-3 text-xs font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              disabled={isPending}
              onClick={() => onRestore(row)}
            >
              <ArchiveRestore className="mr-1.5 h-3.5 w-3.5" />
              Restaurar
            </Button>
          </div>
        );
      }

      return (
        <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            aria-label={`Editar produto ${row.name}`}
            onClick={() => onEdit(row)}
          >
            <Edit3 className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-lg text-amber-600 hover:bg-amber-50 hover:text-amber-700"
            disabled={isPending}
            aria-label={`Arquivar produto ${row.name}`}
            onClick={() => onDelete(row)}
          >
            <Archive className="h-4 w-4" />
          </Button>
        </div>
      );
    },
  } satisfies DataTableColumn<ProductListItem>;

  const columns: DataTableColumn<ProductListItem>[] = [
    {
      id: 'name',
      header: 'Produto',
      width: 'min-w-0 lg:w-[28%]',
      align: 'left',
      noWrap: false,
      skeleton: (
        <div className="flex items-center gap-3">
          <div className="size-14 rounded-xl bg-gray-100" />
          <div className="space-y-2">
            <div className="h-4 w-40 rounded bg-gray-200" />
            <div className="h-3 w-24 rounded bg-gray-100" />
          </div>
        </div>
      ),
      render: (row) => {
        const reference = getProductReference(row);
        const effectiveStock = row.totalStock;

        return (
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 shadow-sm overflow-hidden">
              {row.primaryImageUrl ? (
                <img
                  src={row.primaryImageUrl}
                  alt={row.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <Package2 className="h-6 w-6 text-slate-400" />
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium leading-tight text-slate-900">
                {row.name}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-slate-400">
                {reference.label}: {reference.value}
              </div>
              <div className="mt-1.5 space-y-0.5 lg:hidden text-[11px] text-slate-600">
                {row.category?.name ? <div className="truncate">{row.category.name}</div> : null}
                <div className="font-medium text-slate-900">{formatCurrency(row.price)}</div>
                <div>{effectiveStock} un. em estoque</div>
              </div>
            </div>
          </div>
        );
      },
    },
    {
      id: 'category',
      header: 'Categoria',
      width: 'lg:w-[16%]',
      align: 'left',
      noWrap: false,
      headerClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell',
      skeleton: <div className="h-4 w-28 rounded bg-gray-200" />,
      render: (row) => (
        <div className="min-w-0">
          {row.category?.name ? (
            <span className="block truncate text-sm text-slate-700">{row.category.name}</span>
          ) : (
            <span className="text-sm text-slate-300">—</span>
          )}
        </div>
      ),
    },
    {
      id: 'price',
      header: 'Preço',
      width: 'lg:w-[14%]',
      align: 'left',
      headerClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell',
      skeleton: <div className="h-4 w-24 rounded bg-gray-200" />,
      render: (row) => (
        <div>
          <span className="text-sm font-semibold text-slate-900">{formatCurrency(row.price)}</span>
          {row.hasVariants ? (
            <span className="mt-0.5 block text-[11px] text-slate-400">padrão</span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'margin',
      header: 'Custo e margem',
      width: 'lg:w-[18%]',
      align: 'left',
      noWrap: false,
      headerClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell',
      skeleton: (
        <div className="space-y-1.5">
          <div className="h-3 w-24 rounded bg-gray-100" />
          <div className="h-3 w-28 rounded bg-gray-100" />
        </div>
      ),
      render: (row) => (
        <div className="space-y-0.5 text-[11px] text-slate-500">
          <div>Custo: {formatCurrency(row.averageCost)}</div>
          <div>
            Lucro: {formatCurrency(row.profitPerUnit)} ·{' '}
            <span className={row.profitPerUnit >= 0 ? 'text-emerald-700' : 'text-red-700'}>
              {formatMarginPercent(row.marginPercent)}
            </span>
          </div>
          {row.hasVariants ? <div className="text-slate-400">média das variantes</div> : null}
        </div>
      ),
    },
    {
      id: 'stock',
      header: 'Estoque',
      width: 'lg:w-[14%]',
      align: 'left',
      noWrap: false,
      headerClassName: 'hidden lg:table-cell',
      cellClassName: 'hidden lg:table-cell',
      skeleton: (
        <div className="space-y-2">
          <div className="h-1.5 w-28 rounded-full bg-gray-100" />
          <div className="h-3 w-14 rounded bg-gray-100" />
        </div>
      ),
      render: (row) => {
        const effectiveStock = row.totalStock;
        const stockProgress = row.hasVariants
          ? getDerivedStockProgress(row)
          : getStockProgress(effectiveStock, row.lowStockThreshold);

        return (
          <div className="w-full max-w-[132px]">
            <Progress
              value={stockProgress.value}
              className={`h-1.5 ${stockProgress.trackClassName}`}
              indicatorClassName={stockProgress.indicatorClassName}
              aria-label={`${stockProgress.label}: ${effectiveStock} unidade(s) em estoque`}
            />
            <div className="mt-1 text-[11px] text-slate-400">{effectiveStock} unidade(s)</div>
          </div>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      width: 'w-[4.5rem] max-lg:shrink-0 lg:w-[10%]',
      align: 'center',
      headerClassName: 'max-lg:px-1',
      cellClassName: 'max-lg:px-1',
      skeleton: <div className="mx-auto h-5 w-9 rounded-full bg-gray-200" />,
      render: (row) => {
        const isPending = pendingIds.has(row.id);

        if (viewMode === 'archived') {
          return (
            <div className="flex justify-center">
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-500">
                Arquivado
              </span>
            </div>
          );
        }

        return (
          <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
            <Switch
              checked={row.isActive}
              disabled={isPending}
              aria-label={
                row.isActive ? `Inativar produto ${row.name}` : `Ativar produto ${row.name}`
              }
              onCheckedChange={(active) => onToggleStatus(row, active)}
              className="h-5 w-9 bg-slate-200 disabled:cursor-wait disabled:opacity-70 data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-red-400"
              thumbClassName="h-4 w-4 bg-white shadow-sm data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0"
            />
          </div>
        );
      },
    },
    actionColumn,
  ];

  return (
    <DataTable
      columns={columns}
      data={products}
      rowKey={(row) => row.id}
      loading={loading}
      skeletonRows={8}
      ariaLabel="Tabela de produtos"
      onRowClick={viewMode === 'catalog' ? onEdit : undefined}
      emptyMessage={
        <div className="px-6 py-12 text-center text-gray-500 text-sm">
          {searchTerm
            ? 'Nenhum produto encontrado para esta busca.'
            : viewMode === 'archived'
              ? 'Nenhum produto arquivado.'
              : 'Nenhum produto cadastrado. Clique em "Novo produto" para começar.'}
        </div>
      }
    />
  );
}

export function ProdutosFeature() {
  const router = useRouter();
  const { user: _user } = useCurrentUser();

  const { items, loading, meta, reload, remove, restore, toggleActive } = useProducts();

  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ProductViewMode>('catalog');

  const [searchTerm, setSearchTerm] = useState('');
  const [sortOrder, setSortOrder] = useState<SortOrder>('DESC');
  const [statusFilter, setStatusFilter] = useState<StatusValue>('TODOS');
  const [page, setPage] = useState(1);

  async function handleToggleStatus(product: ProductListItem, active: boolean) {
    if (pendingIds.has(product.id)) return;
    setPendingIds((prev) => new Set(prev).add(product.id));
    try {
      await toggleActive(product.id, active);
    } catch (err) {
      toast.error((err as Error).message ?? 'Não foi possível alterar o status do produto.');
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(product.id);
        return next;
      });
    }
  }

  async function handleRestoreProduct(product: ProductListItem) {
    if (pendingIds.has(product.id)) return;
    setPendingIds((prev) => new Set(prev).add(product.id));
    try {
      await restore(product.id);
      toast.success(`Produto "${product.name}" restaurado`);
      void reload({ search: searchTerm, page, pageSize: PAGE_SIZE, archived: true });
    } catch (err) {
      toast.error((err as Error).message ?? 'Não foi possível restaurar o produto.');
    } finally {
      setPendingIds((prev) => {
        const next = new Set(prev);
        next.delete(product.id);
        return next;
      });
    }
  }

  const deleteDialog = useDeleteDialog<ProductListItem>({
    onDelete: async (product) => {
      await remove(product.id);
    },
  });

  useEffect(() => {
    void reload({
      search: searchTerm,
      page,
      pageSize: PAGE_SIZE,
      archived: viewMode === 'archived',
    });
  }, [searchTerm, page, reload, viewMode]);

  function handleEdit(product: ProductListItem) {
    router.push(`/vendas/produtos/${product.id}/editar`);
  }

  const filtered = useMemo(
    () =>
      items.filter((product) => {
        if (viewMode === 'archived') return true;
        if (statusFilter === 'ATIVO') return product.isActive;
        if (statusFilter === 'INATIVO') return !product.isActive;
        return true;
      }),
    [items, statusFilter, viewMode],
  );

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    const nameA = a.name.toLowerCase();
    const nameB = b.name.toLowerCase();
    return sortOrder === 'ASC' ? nameA.localeCompare(nameB) : nameB.localeCompare(nameA);
  });

  const totalPages = Math.ceil(meta.total / PAGE_SIZE);
  const viewTabs = (
    <Tabs
      value={viewMode}
      onValueChange={(value) => {
        setViewMode(value as ProductViewMode);
        setPage(1);
        setStatusFilter('TODOS');
      }}
    >
      <TabsList className="h-10 rounded-lg bg-slate-100/80">
        <TabsTrigger value="catalog" className="h-8 rounded-md px-4 text-sm shadow-none">
          Catálogo
        </TabsTrigger>
        <TabsTrigger value="archived" className="h-8 rounded-md px-4 text-sm shadow-none">
          Arquivados
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );

  return (
    <>
      <TableLayout
        title="Produtos"
        subtitle="Gerencie os produtos disponíveis para venda."
        actions={
          <Button
            onClick={() => router.push('/vendas/produtos/novo')}
            className="h-10 w-full bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90 lg:w-auto"
          >
            <Plus className="h-4 w-4" />
            Novo produto
          </Button>
        }
        filtersBar={
          <EntityFiltersBar
            searchValue={searchTerm}
            onSearchChange={(v) => {
              setSearchTerm(v);
              setPage(1);
            }}
            searchPlaceholder={
              viewMode === 'archived' ? 'Buscar arquivado...' : 'Buscar produto...'
            }
            statusValue={statusFilter}
            onStatusChange={(v) => {
              setStatusFilter(v);
              setPage(1);
            }}
            hideStatusFilter={viewMode === 'archived'}
            sortOrder={sortOrder}
            onSortChange={setSortOrder}
            extraLeft={viewTabs}
          />
        }
        footer={
          totalPages > 1 ? (
            <Pagination page={page} total={meta.total} pageSize={PAGE_SIZE} onChange={setPage} />
          ) : null
        }
      >
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <ProdutosTable
            products={sorted}
            loading={loading}
            searchTerm={searchTerm}
            viewMode={viewMode}
            pendingIds={pendingIds}
            onEdit={handleEdit}
            onDelete={(product) => deleteDialog.openDialog(product)}
            onToggleStatus={handleToggleStatus}
            onRestore={handleRestoreProduct}
          />
        </div>
      </TableLayout>

      <ConfirmDeleteDialog
        open={deleteDialog.open}
        onOpenChange={deleteDialog.onOpenChange}
        title="Arquivar produto"
        description={`Deseja arquivar o produto "${deleteDialog.entity?.name}"? Ele não aparecerá mais na listagem, mas poderá ser restaurado.`}
        onConfirm={deleteDialog.confirm}
        confirmLabel="Arquivar"
      />
    </>
  );
}

export default ProdutosFeature;
